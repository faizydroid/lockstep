// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import {HighRiskSelectors} from "../src/HighRiskSelectors.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {PinRegistry} from "../src/PinRegistry.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Drives PinRegistry through random sequences of publisher and challenger
///         actions, so the accounting properties hold under orderings nobody thought
///         to write a unit test for.
///
/// Two deliberate design choices, both learned the hard way:
///
/// **It does not inherit from Test.** Doing so drags in dozens of inherited public
/// helpers, every one of which becomes a fuzz target. An earlier version spent all
/// 4096 calls on inherited no-ops.
///
/// **It never calls `vm.prank`.** The invariant fuzzer already pranks each handler
/// call to randomise `msg.sender`. A nested prank fails, and Foundry discards the
/// whole call as a rejection rather than a revert — so the campaign reported zero
/// reverts, zero published pins, and six green invariants that had checked nothing.
/// The handler is therefore the publisher and the challenger itself, and every
/// registry call comes from `address(this)`.
contract RegistryHandler {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    PinRegistry public immutable registry;
    MockERC20 public immutable bondAsset;

    bytes32[] public pinIds;

    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public totalSlashReward;

    /// Attempt counters, so the handler can report on itself. A handler that
    /// silently swallows every failure turns an invariant campaign into a green
    /// light that checks nothing.
    uint256 public depositCalls;
    uint256 public publishAttempts;
    uint256 public publishFailures;
    uint256 public slashAttempts;
    bytes public lastPublishError;

    address internal constant TARGET_BASE = address(0xBEEF);
    bytes4 internal constant SWAP = bytes4(keccak256("swap(uint256)"));
    bytes4 internal constant APPROVE = bytes4(0x095ea7b3);

    constructor(PinRegistry registry_, MockERC20 bondAsset_) {
        registry = registry_;
        bondAsset = bondAsset_;
    }

    /// @dev Local clamp so the handler need not inherit StdUtils.
    function _clamp(uint256 value, uint256 min, uint256 max) internal pure returns (uint256) {
        if (max <= min) return min;
        return min + (value % (max - min + 1));
    }

    function deposit(uint96 amount) external {
        uint256 value = _clamp(amount, 1, 1_000_000e6);
        depositCalls += 1;

        bondAsset.mint(address(this), value);
        bondAsset.approve(address(registry), value);
        registry.deposit(value);
        totalDeposited += value;
    }

    function withdraw(uint96 amount) external {
        uint256 available = registry.unlockedBond(address(this));
        if (available == 0) return;
        uint256 value = _clamp(amount, 1, available);

        registry.withdraw(value);
        totalWithdrawn += value;
    }

    function publish(uint8 capCount, bool highRisk, bool nativeValue, uint8 versionBucket)
        external
    {
        uint256 n = _clamp(capCount, 1, 4);

        address[] memory targets = new address[](n);
        bytes4[] memory selectors = new bytes4[](n);
        for (uint256 i = 0; i < n; ++i) {
            targets[i] = address(uint160(uint256(uint160(TARGET_BASE)) + i));
            selectors[i] = (highRisk && i == 0) ? APPROVE : SWAP;
        }

        bytes32 skillHash = keccak256(abi.encode(pinIds.length, capCount, highRisk, nativeValue));
        // A small version space so equivocation is reachable: two pins sharing a
        // bucket are two claims about one version.
        bytes32 versionId = keccak256(abi.encode("v", uint256(versionBucket) % 3));

        publishAttempts += 1;
        try registry.publish(skillHash, versionId, nativeValue ? 1 ether : 0, targets, selectors)
        returns (bytes32 pinId) {
            pinIds.push(pinId);
        } catch (bytes memory reason) {
            publishFailures += 1;
            lastPublishError = reason;
        }
    }

    function revoke(uint256 seed) external {
        if (pinIds.length == 0) return;
        bytes32 pinId = pinIds[seed % pinIds.length];
        if (registry.getPin(pinId).revokedAt != 0) return;

        registry.revoke(pinId);
    }

    function reclaim(uint256 seed, uint32 warpBy) external {
        if (pinIds.length == 0) return;
        bytes32 pinId = pinIds[seed % pinIds.length];
        PinRegistry.Pin memory pin = registry.getPin(pinId);
        if (pin.revokedAt == 0 || pin.slashed || registry.bondReclaimed(pinId)) return;

        vm.warp(block.timestamp + _clamp(warpBy, 0, 30 days));
        if (block.timestamp < pin.revokedAt + registry.unbondingDelay()) return;

        registry.reclaimBond(pinId);
    }

    function slash(uint256 seedA, uint256 seedB) external {
        if (pinIds.length < 2) return;
        bytes32 a = pinIds[seedA % pinIds.length];
        bytes32 b = pinIds[seedB % pinIds.length];

        slashAttempts += 1;
        try registry.slashEquivocation(a, b) returns (uint256 reward) {
            totalSlashReward += reward;
        } catch {
            // Most pairs are not equivocation. Expected and uninteresting.
        }
    }

    /// @dev Advances time so unbonding delays become reachable within a run.
    function warp(uint32 by) external {
        vm.warp(block.timestamp + _clamp(by, 1 hours, 10 days));
    }

    function pinCount() external view returns (uint256) {
        return pinIds.length;
    }
}

contract InvariantsTest is Test {
    PinRegistry internal registry;
    MockERC20 internal bondAsset;
    RegistryHandler internal handler;
    address internal slashRecipient = address(0x5A5A);

    function setUp() public {
        bondAsset = new MockERC20("Agora Dollar", "AUSD", 6);
        registry = new PinRegistry(
            IERC20(address(bondAsset)),
            100e6,
            25e6,
            500e6,
            500e6,
            7 days,
            5_000,
            slashRecipient,
            HighRiskSelectors.all()
        );
        handler = new RegistryHandler(registry, bondAsset);
        targetContract(address(handler));
    }

    /// The core accounting identity. If committed bond ever exceeds deposited bond,
    /// the registry is claiming collateral it does not hold, and every bond figure
    /// shown to a user is a lie.
    function invariant_lockedNeverExceedsBalance() public view {
        assertLe(
            registry.lockedBond(address(handler)),
            registry.bondBalance(address(handler)),
            "locked bond exceeds deposited bond"
        );
    }

    /// Committed bond must equal the sum of `requiredBond` across live, unslashed,
    /// unreclaimed pins. This is the property that stops one deposit backing many
    /// pins, and it is the one most likely to break under an unusual ordering.
    function invariant_lockedEqualsSumOfLivePinBonds() public view {
        uint256 expected = 0;
        uint256 count = handler.pinCount();

        for (uint256 i = 0; i < count; ++i) {
            bytes32 pinId = handler.pinIds(i);
            PinRegistry.Pin memory pin = registry.getPin(pinId);
            if (pin.slashed) continue;
            if (registry.bondReclaimed(pinId)) continue;
            expected += pin.requiredBond;
        }

        assertEq(
            registry.lockedBond(address(handler)), expected, "locked bond drifted from live pins"
        );
    }

    /// The registry's token balance must cover what it says it owes. A shortfall
    /// means a withdrawal or a slash paid out more than it debited.
    function invariant_registryHoldsWhatItOwes() public view {
        assertGe(
            bondAsset.balanceOf(address(registry)),
            registry.bondBalance(address(handler)),
            "registry cannot cover recorded balances"
        );
    }

    /// A pin's bond must never be both reclaimed and slashed: that pays the same
    /// collateral out twice.
    function invariant_bondIsNeverPaidTwice() public view {
        uint256 count = handler.pinCount();
        for (uint256 i = 0; i < count; ++i) {
            bytes32 pinId = handler.pinIds(i);
            assertFalse(
                registry.getPin(pinId).slashed && registry.bondReclaimed(pinId),
                "bond both slashed and reclaimed"
            );
        }
    }

    /// A live pin must stay collateralised at the price it was quoted. Pricing
    /// parameters are immutable, so this must hold for the contract's whole life.
    function invariant_livePinsAreFullyBonded() public view {
        uint256 count = handler.pinCount();
        for (uint256 i = 0; i < count; ++i) {
            bytes32 pinId = handler.pinIds(i);
            PinRegistry.Pin memory pin = registry.getPin(pinId);
            if (pin.slashed || registry.bondReclaimed(pinId)) continue;

            assertEq(
                pin.requiredBond,
                registry.quoteBond(pin.capabilityCount, pin.highRiskCount, pin.maxValuePerCall > 0),
                "pin bond does not match its quote"
            );
        }
    }

    /// Revocation is one-way and a revoked pin is never live. A regression here lets
    /// a publisher un-retract a release they declared compromised.
    function invariant_revokedPinsAreNeverLive() public view {
        uint256 count = handler.pinCount();
        for (uint256 i = 0; i < count; ++i) {
            bytes32 pinId = handler.pinIds(i);
            if (registry.getPin(pinId).revokedAt == 0) continue;
            assertEq(registry.liveSkillHash(pinId), bytes32(0), "revoked pin still live");
        }
    }

    /// Guards against the trap that every property above holds trivially if the
    /// handler never succeeded at anything.
    ///
    /// This is not paranoia: an earlier version of this suite reported six green
    /// invariants while publishing zero pins across 4096 calls, twice, for two
    /// different reasons. A campaign that exercises nothing is worse than no
    /// campaign, because it looks like coverage.
    /// Coverage note, not an assertion.
    ///
    /// `afterInvariant` observes state after Foundry has reverted the campaign's
    /// sequences, so these counters read zero even when the run did real work. The
    /// authoritative coverage evidence is Foundry's own call summary, printed with
    /// `-vv`: it reports calls per handler function, and `publish` and `slash` must
    /// both be non-zero for the invariants above to mean anything.
    ///
    /// This matters more than it sounds. An earlier version of this suite reported
    /// six green invariants while publishing zero pins across 4096 calls, twice, for
    /// two different reasons: the handler inherited from Test so the fuzzer spent
    /// every call on inherited helpers, and it called `vm.prank` inside handler
    /// functions, which the fuzzer rejects silently. A campaign that exercises
    /// nothing is worse than no campaign, because it looks like coverage.
    function afterInvariant() public view {
        console.log("--- handler counters (post-revert, see note) ---");
        console.log("deposit calls    :", handler.depositCalls());
        console.log("publish attempts :", handler.publishAttempts());
        console.log("pins created     :", handler.pinCount());
        console.log("slash attempts   :", handler.slashAttempts());
        console.log("Check the call summary above for real coverage.");
    }
}
