// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {stdError} from "forge-std/Test.sol";

import {Fixtures} from "./Fixtures.sol";
import {IIdentityRegistry, IReputationRegistry} from "../src/interfaces/IERC8004.sol";
import {LockstepGuard} from "../src/LockstepGuard.sol";
import {IGuardedAccount, LockstepLens} from "../src/LockstepLens.sol";
import {PinRegistry} from "../src/PinRegistry.sol";

/// @dev Stands in for a venue such as the Kuru router.
contract Venue {
    uint256 public swaps;

    function swap(uint256 amountIn) external payable returns (uint256) {
        swaps += 1;
        return amountIn * 2;
    }

    receive() external payable {}
}

/// @notice Returns `true` for every pin. The cheapest possible forged reviewer.
contract LyingApprover {
    function isPinApproved(bytes32) external pure returns (bool) {
        return true;
    }
}

/// @notice A guard-shaped implementation that is not *the* guard.
contract PermissiveRival {
    function isPinApproved(bytes32) external pure returns (bool) {
        return true;
    }
}

/// @notice Tries to deploy a contract whose runtime code *is* an EIP-7702 delegation designator.
///
/// If this succeeded, `LockstepLens.isGuardedAccount` would be forgeable without ever holding the
/// account's key, and the whole Sybil filter would fall to a deployment.
contract DesignatorForger {
    /// @dev Initcode prelude that returns the 23 bytes following it as the new contract's code:
    ///
    ///        PUSH1 0x17  PUSH1 0x0c  PUSH1 0x00  CODECOPY  PUSH1 0x17  PUSH1 0x00  RETURN
    ///
    ///      Twelve bytes long, so the payload begins at offset 0x0c.
    bytes internal constant PRELUDE = hex"6017600c60003960176000f3";

    /// @dev Returns the deployed address, or zero if the chain refused the creation.
    function tryDeployCode(bytes3 prefix, address impl) external returns (address deployed) {
        bytes memory initcode = abi.encodePacked(PRELUDE, prefix, impl);
        assembly {
            deployed := create(0, add(initcode, 0x20), mload(initcode))
        }
    }
}

/// @notice Minimal ERC-8004 stand-ins. Only the two behaviours the lens reads.
contract StubReputation is IReputationRegistry {
    address[] internal clients;

    function giveFeedback(uint256, address client, int128) external {
        clients.push(client);
    }

    function getSummary(uint256, address[] calldata clientAddresses, string calldata, string calldata)
        external
        pure
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)
    {
        return (uint64(clientAddresses.length), int128(100), 0);
    }

    function getClients(uint256) external view returns (address[] memory) {
        return clients;
    }

    function readFeedback(uint256, address, uint64)
        external
        pure
        returns (int128, uint8, string memory, string memory, bool)
    {
        return (0, 0, "", "", false);
    }

    function getLastIndex(uint256, address) external pure returns (uint64) {
        return 0;
    }
}

contract StubIdentity is IIdentityRegistry {
    function ownerOf(uint256) external pure returns (address) {
        return address(0xA9E7);
    }

    function getAgentWallet(uint256) external pure returns (address) {
        return address(0xA9E7);
    }

    function getMetadata(uint256, string calldata) external pure returns (bytes memory) {
        return "";
    }
}

/// @title Adversarial
/// @notice Each of the four exploitable holes closed in this pass, written as the attack rather
///         than as a property.
///
/// The per-fix tests live next to the code they cover — `Slashing.t.sol`, `LockstepLens.t.sol`,
/// `LockstepGuard.t.sol`. This file exists for a different reason: those tests assert that a check
/// fires, and a check firing is not the same claim as an attack failing. Here the attacker runs the
/// whole sequence — publish honestly, collect a real approval, then try to convert it into money —
/// and each test names the step that stops them.
///
/// Every one of these attacks worked before this pass. Three of them were free.
///
/// One test in here does the opposite job: `test_aDifferentPublisherMayReuseAName` records something
/// that is *still* possible. It is in an adversarial suite deliberately, because a reader looking for
/// the limits of this system should find them in the same place as the defences.
contract AdversarialTest is Fixtures {
    Venue internal venue;
    LockstepLens internal lens;
    StubReputation internal repRegistry;
    StubIdentity internal idRegistry;

    address internal publisher;
    address internal attacker;
    address internal executor;

    uint256 internal constant VICTIM_PK = 0x5EED;
    address payable internal victim;

    bytes4 internal SWAP;

    /// The honest release: name, version, and the bytes the publisher committed to.
    string internal constant NAME = "kuru-quote";
    string internal constant V1 = "1.0.0";
    bytes32 internal constant HONEST_BYTES = keccak256("honest skill bytes");
    bytes32 internal constant HOSTILE_BYTES = keccak256("hostile skill bytes");

    bytes32 internal honestPin;

    function setUp() public {
        publisher = makeAddr("publisher");
        attacker = makeAddr("attacker");
        executor = makeAddr("executor");
        venue = new Venue();
        SWAP = Venue.swap.selector;

        deployCore();
        repRegistry = new StubReputation();
        idRegistry = new StubIdentity();
        lens = new LockstepLens(registry, idRegistry, repRegistry, address(guardImpl));

        fundPublisher(publisher, 1_000_000 * ONE_AUSD);
        fundPublisher(attacker, 1_000_000 * ONE_AUSD);

        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(address(venue), SWAP);
        vm.prank(publisher);
        honestPin =
            registry.publish(publishParams(NAME, V1, HONEST_BYTES, 1 ether, targets, selectors));

        // A real victim: their own key delegates the account to the guard, they approve the honest
        // pin, and they authorise the agent as an executor. This is the state every attack below
        // tries to monetise.
        victim = payable(vm.addr(VICTIM_PK));
        vm.signAndAttachDelegation(address(guardImpl), VICTIM_PK);
        vm.deal(victim, 100 ether);
        vm.startPrank(victim);
        LockstepGuard(victim).approvePin(honestPin);
        LockstepGuard(victim).authorizeExecutor(executor);
        vm.stopPrank();
    }

    function _swapCalls(uint256 count, uint256 each)
        internal
        view
        returns (LockstepGuard.Call[] memory calls)
    {
        calls = new LockstepGuard.Call[](count);
        for (uint256 i = 0; i < count; ++i) {
            calls[i] = LockstepGuard.Call({
                target: address(venue),
                value: each,
                data: abi.encodeCall(Venue.swap, (1))
            });
        }
    }

    function _pinSet(bytes32 pinId) internal pure returns (bytes32[] memory set) {
        set = new bytes32[](1);
        set[0] = pinId;
    }

    /* ==================================================================================
       Attack 1 — the silent replacement

       Publish 1.0.0 honestly, collect approvals, then republish different bytes while the
       chain records an unrelated version id. Users keep reading "1.0.0" from a manifest, so
       nothing they can see changed, and `slashEquivocation` sees two pins with different
       version ids and finds no contradiction. The bond became decorative.

       It cost one `cast send`. The honest CLI derived the id correctly, which is exactly why
       nothing caught it.
       ================================================================================== */

    /// The attack is now unrepresentable: there is no version id to supply. The registry derives it
    /// from the label, so the *only* way to get a different id on chain is to state a different
    /// label in public — which is a new release, not a silent replacement.
    function test_theVersionIdCannotBeChosenIndependentlyOfTheLabel() public {
        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(address(venue), SWAP);

        vm.prank(publisher);
        bytes32 republished = registry.publish(
            publishParams(NAME, V1, HOSTILE_BYTES, 1 ether, targets, selectors)
        );

        // Same label in, same id out. The attacker had no input to the id at all.
        bytes32 expected = registry.computeVersionId(NAME, V1);
        assertEq(registry.getPin(honestPin).versionId, expected);
        assertEq(registry.getPin(republished).versionId, expected);
    }

    /// And because the ids now match, the contradiction is visible and priced. This is the whole
    /// chain of reasoning the bond depends on, in one test.
    function test_theSilentReplacementIsNowSlashable() public {
        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(address(venue), SWAP);

        vm.warp(block.timestamp + 1 days);
        vm.prank(publisher);
        bytes32 republished = registry.publish(
            publishParams(NAME, V1, HOSTILE_BYTES, 1 ether, targets, selectors)
        );

        uint256 bond = registry.getPin(republished).requiredBond;
        assertGt(bond, 0);

        address watcher = makeAddr("watcher");
        vm.prank(watcher);
        uint256 reward = registry.slashEquivocation(honestPin, republished);

        assertGt(reward, 0, "the watcher was paid to notice");
        assertTrue(registry.getPin(republished).slashed);
        // Both claims are dead: a user cannot be expected to know which was honest.
        assertEq(registry.liveSkillHash(honestPin), bytes32(0));
        assertEq(registry.liveSkillHash(republished), bytes32(0));
    }

    /// The evasion one layer up. Deriving the id from the label only helps if the label cannot be
    /// made to *look* like the trusted one. Each of these renders as `kuru-quote` in a UI and hashes
    /// to an unrelated version id.
    function test_confusableLabelsAreRefusedAtPublish() public {
        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(address(venue), SWAP);

        string[4] memory confusables = [
            "kuru-quote ", // trailing space
            " kuru-quote", // leading space
            "kuru-qu\u043Ete", // Cyrillic o
            "kuru\tquote" // tab
        ];

        for (uint256 i = 0; i < confusables.length; ++i) {
            vm.prank(attacker);
            vm.expectRevert(PinRegistry.LabelNotPrintableAscii.selector);
            registry.publish(
                publishParams(confusables[i], V1, HOSTILE_BYTES, 1 ether, targets, selectors)
            );
        }
    }

    /// A published pin is publisher-scoped, so even a successful republish cannot inherit the
    /// victim's approval. Worth asserting rather than assuming: it is the reason equivocation is a
    /// fraud on labelling rather than a direct bypass.
    function test_republishedBytesCannotRideTheVictimsApproval() public {
        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(address(venue), SWAP);

        vm.prank(publisher);
        bytes32 republished = registry.publish(
            publishParams(NAME, "1.0.1", HOSTILE_BYTES, 1 ether, targets, selectors)
        );

        assertFalse(LockstepGuard(victim).isPinApproved(republished));

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(LockstepGuard.PinNotApproved.selector, republished)
        );
        LockstepGuard(victim).execute(republished, HOSTILE_BYTES, _swapCalls(1, 0));
    }

    /* ==================================================================================
       Known limit, not a defence — recorded here on purpose.
       ================================================================================== */

    /// This registry has **no name ownership**. A different publisher may publish under a name they
    /// did not originate, and it is not equivocation, because it is not a contradiction: two
    /// publishers making different claims about their own code is the normal case.
    ///
    /// The reason that is tolerable is the assertion at the end. Pins are keyed by
    /// `(publisher, skillHash)` and approvals are per pin, so a squatter inherits nothing: no
    /// approval, no reputation, no bond. What they get is a name collision in a listing — which is a
    /// real UI hazard and the reason any surface showing a skill name must show the publisher beside
    /// it, and is checked for in `scripts/check-export.mjs` rather than left to reviewer memory.
    function test_aDifferentPublisherMayReuseAName() public {
        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(address(venue), SWAP);

        vm.prank(attacker);
        bytes32 squatted = registry.publish(
            publishParams(NAME, V1, HOSTILE_BYTES, 1 ether, targets, selectors)
        );

        // Same version id, different publisher, so no contradiction exists to prove.
        assertEq(
            registry.getPin(squatted).versionId, registry.getPin(honestPin).versionId, "same label"
        );
        vm.expectRevert(
            abi.encodeWithSelector(PinRegistry.NotSamePublisher.selector, publisher, attacker)
        );
        registry.slashEquivocation(honestPin, squatted);

        // And the squatter inherits nothing that matters.
        assertTrue(squatted != honestPin, "distinct pins");
        assertFalse(LockstepGuard(victim).isPinApproved(squatted));
    }

    /* ==================================================================================
       Attack 2 — manufacturing reputation

       `LockstepLens` decided reviewer eligibility by staticcalling `isPinApproved` on a
       candidate and believing the answer. `isPinApproved` is a one-line view, so the entire
       Sybil filter — the contract's stated reason to exist — fell to a stub.
       ================================================================================== */

    /// Thirty-two forged reviewers and one real account. Under the old check the attacker owned the
    /// score outright.
    function test_forgedReviewersCannotEnterTheClientSet() public {
        address[] memory candidates = new address[](33);
        for (uint256 i = 0; i < 32; ++i) {
            address stub = address(new LyingApprover());
            candidates[i] = stub;
            repRegistry.giveFeedback(1, stub, 100);
            // The lie itself still works. It just buys nothing.
            assertTrue(IGuardedAccount(stub).isPinApproved(honestPin));
        }
        candidates[32] = victim;

        address[] memory eligible = lens.eligibleReviewers(candidates, _pinSet(honestPin));

        assertEq(eligible.length, 1, "only the account that actually delegated");
        assertEq(eligible[0], victim);
    }

    /// Delegating to an attacker's own permissive "guard" is a genuine EIP-7702 delegation with a
    /// genuine designator. It is still not this guard, so the approval it reports enforces nothing.
    function test_delegatingToAnAttackerControlledImplementationIsNotEnough() public {
        PermissiveRival rival = new PermissiveRival();
        uint256 pk = 0xBAD1;
        address payable forged = payable(vm.addr(pk));
        vm.signAndAttachDelegation(address(rival), pk);

        assertEq(forged.code, abi.encodePacked(hex"ef0100", address(rival)), "really delegated");
        assertTrue(IGuardedAccount(forged).isPinApproved(honestPin), "and it really says yes");

        assertFalse(lens.isGuardedAccount(forged));
        assertFalse(lens.isEligibleReviewer(forged, _pinSet(honestPin)));
    }

    /// The assumption the whole check rests on, proved rather than asserted.
    ///
    /// `isGuardedAccount` compares `EXTCODEHASH` against `keccak256(0xef0100 || guard)`. That is only
    /// sufficient because a *contract* can never carry those bytes as its code: EIP-3541 rejects any
    /// creation returning code that begins with `0xEF`. Without that rule an attacker would deploy
    /// the designator directly and forge unlimited reviewers without ever holding a key.
    ///
    /// The control matters as much as the case. A test that only showed the `0xEF` deployment
    /// failing would pass just as happily if the initcode were malformed, so the same initcode is
    /// first shown to work with a `0xEE` prefix.
    function test_aContractCannotCarryADelegationDesignatorAsItsCode() public {
        DesignatorForger forger = new DesignatorForger();

        // Both calls are gas-capped, and the reason is worth knowing before someone removes it: a
        // creation rejected by EIP-3541 halts exceptionally, which consumes every unit of gas
        // forwarded to the sub-context. Uncapped, this one test billed over a billion gas. `CREATE`
        // failing does not revert its caller, so the cap bounds the waste without changing what is
        // being measured. 400k is ample for a 23-byte deploy, which costs about 37k.
        uint256 cap = 400_000;

        // Control: the initcode is correct and deploys a 23-byte blob when the prefix is legal.
        address benign = forger.tryDeployCode{gas: cap}(hex"ee0100", address(guardImpl));
        assertTrue(benign != address(0), "the initcode itself works");
        assertEq(benign.code, abi.encodePacked(hex"ee0100", address(guardImpl)));
        assertEq(benign.code.length, lens.DESIGNATOR_LENGTH());

        // The real attempt: identical but for the one byte that matters.
        address forged = forger.tryDeployCode{gas: cap}(hex"ef0100", address(guardImpl));
        assertEq(forged, address(0), "EIP-3541 refuses 0xEF-prefixed code");

        // And the near miss is not mistaken for the real thing.
        assertFalse(lens.isGuardedAccount(benign));
    }

    /* ==================================================================================
       Attack 3 — splitting the spend

       The pin's ceiling was checked per call, and nothing bounded how many calls a batch
       could hold. A compromised executor moved any amount it liked in one transaction.
       ================================================================================== */

    /// The victim's pin permits 1 MON. The executor is the agent, and the threat model assumes it
    /// can be compromised, so this is the whole attack: same approval, same pin, thirty-two calls.
    function test_aCompromisedExecutorCannotSplitPastTheCeiling() public {
        uint256 max = LockstepGuard(victim).MAX_CALLS();
        LockstepGuard.Call[] memory calls = _swapCalls(max, 1 ether);

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                LockstepGuard.BatchValueExceedsCeiling.selector, max * 1 ether, 1 ether
            )
        );
        LockstepGuard(victim).execute(honestPin, HONEST_BYTES, calls);

        assertEq(address(venue).balance, 0, "nothing left the account");
        assertEq(victim.balance, 100 ether);
    }

    /// Padding the batch past the loop bound is refused before the value maths is even reached.
    function test_theBatchLengthItselfIsBounded() public {
        uint256 max = LockstepGuard(victim).MAX_CALLS();

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(LockstepGuard.TooManyCalls.selector, max + 1, max)
        );
        LockstepGuard(victim).execute(honestPin, HONEST_BYTES, _swapCalls(max + 1, 0));
    }

    /// The arithmetic escape: choose values that sum to something small modulo 2^256, so a wrapping
    /// total would pass the budget check while each call moves a fortune. Checked arithmetic makes
    /// the sum revert instead of wrapping, and this test exists so nobody "optimises" it into an
    /// `unchecked` block.
    function test_theValueTotalCannotBeWrappedAroundTheCeiling() public {
        LockstepGuard.Call[] memory calls = _swapCalls(2, 0);
        calls[0].value = type(uint256).max;
        calls[1].value = 2; // sum ≡ 1 (mod 2^256), which would sit under a 1 ether ceiling

        vm.prank(executor);
        vm.expectRevert(stdError.arithmeticError);
        LockstepGuard(victim).execute(honestPin, HONEST_BYTES, calls);

        assertEq(address(venue).balance, 0);
    }

    /// And the fix does not break the legitimate case it constrains. A control that blocks honest
    /// use gets switched off.
    function test_anHonestBatchWithinBudgetStillExecutes() public {
        vm.prank(executor);
        LockstepGuard(victim).execute(honestPin, HONEST_BYTES, _swapCalls(4, 0.25 ether));

        assertEq(venue.swaps(), 4);
        assertEq(address(venue).balance, 1 ether);
    }

    /* ==================================================================================
       Attack 4 — the frozen-bond trap

       Not an attack by an outsider. A publisher whose build is not byte-reproducible
       equivocates by accident, and under the old rule both bonds froze permanently: not
       slashed, not returned, no beneficiary. Money destroyed for a mistake.
       ================================================================================== */

    function test_anAccidentalRebuildDoesNotStrandCapitalForever() public {
        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(address(venue), SWAP);

        // The same source, rebuilt, yielding different bytes. Published in good faith.
        vm.warp(block.timestamp + 1 days);
        vm.prank(publisher);
        bytes32 rebuild = registry.publish(
            publishParams(NAME, V1, keccak256("same source, different bytes"), 1 ether, targets, selectors)
        );

        uint256 honestBond = registry.getPin(honestPin).requiredBond;
        assertEq(registry.versionPinCount(publisher, registry.computeVersionId(NAME, V1)), 2);

        // Frozen while the contradiction is unanswered — correct, and it is what a challenger's
        // reward is secured against.
        vm.startPrank(publisher);
        registry.revoke(honestPin);
        vm.warp(block.timestamp + UNBONDING_DELAY + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                PinRegistry.EquivocationUnresolved.selector, registry.computeVersionId(NAME, V1)
            )
        );
        registry.reclaimBond(honestPin);

        // The way out: challenging takes no permissions, so the publisher answers their own
        // contradiction. They forfeit the later claim and recover the earlier one.
        registry.slashEquivocation(honestPin, rebuild);
        vm.warp(block.timestamp + UNBONDING_DELAY + 1);
        registry.reclaimBond(honestPin);
        vm.stopPrank();

        assertTrue(registry.bondReclaimed(honestPin));
        assertEq(registry.lockedBond(publisher), 0, "no stranded collateral");
        assertGt(honestBond, 0);
    }

    /// The freeze must still do its job. An attacker who equivocates cannot revoke, wait out the
    /// delay, and walk away with the bond before a challenger arrives.
    function test_revokeAndRunStillFails() public {
        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(address(venue), SWAP);

        vm.warp(block.timestamp + 1 days);
        vm.prank(publisher);
        bytes32 hostile = registry.publish(
            publishParams(NAME, V1, HOSTILE_BYTES, 1 ether, targets, selectors)
        );

        vm.startPrank(publisher);
        registry.revoke(hostile);
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert(
            abi.encodeWithSelector(
                PinRegistry.EquivocationUnresolved.selector, registry.computeVersionId(NAME, V1)
            )
        );
        registry.reclaimBond(hostile);
        vm.stopPrank();

        // A year late, the bond is still there to take.
        address watcher = makeAddr("watcher");
        vm.prank(watcher);
        uint256 reward = registry.slashEquivocation(honestPin, hostile);
        assertGt(reward, 0, "the collateral outlasted the delay");
    }

    /// A third party cannot manufacture a contradiction to freeze someone else's capital. Griefing
    /// would be a cheap denial of service against every honest publisher on the registry.
    function test_anOutsiderCannotFreezeAPublishersBond() public {
        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(address(venue), SWAP);

        // The attacker publishes the same label. It lands under *their* version count, not the
        // publisher's, because the count is scoped by publisher.
        vm.prank(attacker);
        registry.publish(publishParams(NAME, V1, HOSTILE_BYTES, 1 ether, targets, selectors));

        bytes32 versionId = registry.computeVersionId(NAME, V1);
        assertEq(registry.versionPinCount(publisher, versionId), 1, "untouched");
        assertEq(registry.versionPinCount(attacker, versionId), 1);

        vm.startPrank(publisher);
        registry.revoke(honestPin);
        vm.warp(block.timestamp + UNBONDING_DELAY + 1);
        registry.reclaimBond(honestPin);
        vm.stopPrank();

        assertTrue(registry.bondReclaimed(honestPin), "the honest publisher was not held hostage");
    }
}
