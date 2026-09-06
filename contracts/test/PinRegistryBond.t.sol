// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "./Fixtures.sol";
import {HighRiskSelectors, IRiskySurface} from "../src/HighRiskSelectors.sol";
import {PinRegistry} from "../src/PinRegistry.sol";

contract PinRegistryBondTest is Fixtures {
    address internal publisher;
    address internal other;
    address internal router = address(0x1111);
    address internal token = address(0x2222);

    bytes4 internal constant SWAP = bytes4(keccak256("swap(uint256)"));

    function setUp() public {
        publisher = makeAddr("publisher");
        other = makeAddr("other");
        deployCore();
    }

    // --- deposit and withdraw ---

    function test_depositIncreasesUnlockedBond() public {
        fundPublisher(publisher, 1_000 * ONE_AUSD);

        assertEq(registry.bondBalance(publisher), 1_000 * ONE_AUSD);
        assertEq(registry.unlockedBond(publisher), 1_000 * ONE_AUSD);
        assertEq(registry.lockedBond(publisher), 0);
    }

    function test_withdrawReturnsUnlockedBond() public {
        fundPublisher(publisher, 1_000 * ONE_AUSD);

        vm.prank(publisher);
        registry.withdraw(400 * ONE_AUSD);

        assertEq(ausd.balanceOf(publisher), 400 * ONE_AUSD);
        assertEq(registry.bondBalance(publisher), 600 * ONE_AUSD);
    }

    function test_depositRejectsZero() public {
        vm.prank(publisher);
        vm.expectRevert(PinRegistry.ZeroAmount.selector);
        registry.deposit(0);
    }

    /// A token that signals failure by returning false rather than reverting must
    /// not be treated as a successful deposit.
    function test_depositRejectsSilentTransferFailure() public {
        ausd.mint(publisher, 100 * ONE_AUSD);
        ausd.setFailTransfers(true);

        vm.startPrank(publisher);
        ausd.approve(address(registry), 100 * ONE_AUSD);
        vm.expectRevert(PinRegistry.BondTransferFailed.selector);
        registry.deposit(100 * ONE_AUSD);
        vm.stopPrank();
    }

    // --- pricing ---

    function test_quoteBondPricesBaseAndBreadth() public view {
        assertEq(registry.quoteBond(1, 0, false), BASE_BOND + PER_CAPABILITY_BOND);
        assertEq(registry.quoteBond(4, 0, false), BASE_BOND + 4 * PER_CAPABILITY_BOND);
    }

    function test_quoteBondPricesHighRiskAtAPremium() public view {
        uint256 narrow = registry.quoteBond(1, 0, false);
        uint256 dangerous = registry.quoteBond(1, 1, false);

        assertEq(dangerous - narrow, HIGH_RISK_BOND);
        // The premium must dominate, otherwise declaring `approve` is a rounding
        // error next to declaring one more benign selector.
        assertGt(HIGH_RISK_BOND, PER_CAPABILITY_BOND * 10);
    }

    /// Charged as a flat premium, not scaled by the ceiling. Bond is AUSD with 6
    /// decimals and the ceiling is native wei with 18; multiplying them needs a
    /// price oracle, and an earlier version that did it demanded ~1e19 AUSD units
    /// to pin a 10 MON ceiling.
    function test_nativeValueCapabilityCostsAFlatPremium() public view {
        uint256 without = registry.quoteBond(1, 0, false);

        assertEq(registry.quoteBond(1, 0, true) - without, NATIVE_VALUE_BOND);
    }

    /// The headline economic property: a sweeping manifest costs far more than a
    /// narrow one. This is what stops "declare everything, violate nothing".
    function test_wideManifestCostsFarMoreThanNarrowOne() public view {
        uint256 narrow = registry.quoteBond(1, 0, false);
        uint256 wide = registry.quoteBond(20, 6, true);

        assertGt(wide, narrow * 25);
    }

    /// The bond a pin needs must stay in the same order of magnitude as the asset
    /// it is denominated in. A regression that reintroduces a unit mismatch shows
    /// up here as an absurd number rather than as a confusing revert.
    function test_bondForAWideManifestStaysInSaneAusdRange() public view {
        uint256 wide = registry.quoteBond(20, 6, true);

        assertLt(wide, 1_000_000 * ONE_AUSD, "bond price left plausible AUSD range");
        assertGt(wide, 1_000 * ONE_AUSD);
    }

    /// Every selector in the high-risk set must actually be registered. A typo
    /// would silently under-price the most dangerous capability there is.
    function test_allHighRiskSelectorsAreRegistered() public view {
        bytes4[] memory selectors = HighRiskSelectors.all();
        assertEq(selectors.length, 12);
        for (uint256 i = 0; i < selectors.length; ++i) {
            assertTrue(registry.isHighRiskSelector(selectors[i]), "selector not registered");
        }
    }

    function test_approveIsPricedAsHighRisk() public view {
        assertTrue(registry.isHighRiskSelector(IRiskySurface.approve.selector));
        assertFalse(registry.isHighRiskSelector(SWAP));
    }

    /// A bare native send to an arbitrary address is the most direct drain there
    /// is, and empty calldata is cheap to declare, so it is priced as high risk.
    function test_emptyCalldataIsPricedAsHighRisk() public view {
        assertTrue(registry.isHighRiskSelector(bytes4(0)));
    }

    // --- publishing locks bond ---

    function test_publishLocksTheQuotedBond() public {
        fundPublisher(publisher, 10_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);

        vm.prank(publisher);
        bytes32 pinId = registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));

        uint256 expected = registry.quoteBond(1, 0, false);
        assertEq(registry.lockedBond(publisher), expected);
        assertEq(registry.getPin(pinId).requiredBond, expected);
        assertEq(registry.unlockedBond(publisher), 10_000 * ONE_AUSD - expected);
    }

    function test_publishRevertsWithoutEnoughUnlockedBond() public {
        fundPublisher(publisher, 50 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        // Resolve the quote before pranking: vm.prank applies to the very next
        // call, and an external call inside the expectRevert arguments would
        // consume it, leaving `publish` to run as this contract instead.
        uint256 needed = registry.quoteBond(1, 0, false);

        vm.prank(publisher);
        vm.expectRevert(
            abi.encodeWithSelector(
                PinRegistry.InsufficientUnlockedBond.selector, needed, 50 * ONE_AUSD
            )
        );
        registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));
    }

    /// The hole this closes: without per-pin locking, one deposit backs unlimited
    /// pins and every claim of collateral is a lie.
    function test_oneDepositCannotBackUnlimitedPins() public {
        uint256 oneCapability = registry.quoteBond(1, 0, false);
        // Exactly enough for two pins, not three.
        fundPublisher(publisher, oneCapability * 2);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);

        vm.startPrank(publisher);
        registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));
        registry.publish(defaultParams(keccak256("v2"), 0, targets, selectors));

        vm.expectRevert(
            abi.encodeWithSelector(
                PinRegistry.InsufficientUnlockedBond.selector, oneCapability, 0
            )
        );
        registry.publish(defaultParams(keccak256("v3"), 0, targets, selectors));
        vm.stopPrank();

        assertEq(registry.lockedBond(publisher), oneCapability * 2);
    }

    function test_lockedBondCannotBeWithdrawn() public {
        fundPublisher(publisher, 1_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);

        vm.startPrank(publisher);
        registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));
        uint256 locked = registry.lockedBond(publisher);
        uint256 available = registry.unlockedBond(publisher);

        vm.expectRevert(
            abi.encodeWithSelector(
                PinRegistry.InsufficientUnlockedBond.selector, available + 1, available
            )
        );
        registry.withdraw(available + 1);
        vm.stopPrank();

        assertEq(registry.lockedBond(publisher), locked);
    }

    /// Padding a manifest with repeats would inflate the priced capability count
    /// without widening real capability, faking an expensive bond.
    function test_duplicateCapabilitiesAreRejected() public {
        fundPublisher(publisher, 10_000 * ONE_AUSD);
        address[] memory targets = new address[](2);
        bytes4[] memory selectors = new bytes4[](2);
        targets[0] = router;
        targets[1] = router;
        selectors[0] = SWAP;
        selectors[1] = SWAP;

        vm.prank(publisher);
        vm.expectRevert(
            abi.encodeWithSelector(PinRegistry.DuplicateCapability.selector, router, SWAP)
        );
        registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));
    }

    function test_capabilityCountIsCapped() public {
        fundPublisher(publisher, 1_000_000 * ONE_AUSD);
        uint256 n = registry.MAX_CAPABILITIES() + 1;
        address[] memory targets = new address[](n);
        bytes4[] memory selectors = new bytes4[](n);
        for (uint256 i = 0; i < n; ++i) {
            targets[i] = address(uint160(i + 1));
            selectors[i] = SWAP;
        }

        vm.prank(publisher);
        vm.expectRevert(
            abi.encodeWithSelector(
                PinRegistry.TooManyCapabilities.selector, n, registry.MAX_CAPABILITIES()
            )
        );
        registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));
    }

    function test_highRiskCapabilityRequiresTheLargerBond() public {
        uint256 needed = registry.quoteBond(1, 1, false);
        fundPublisher(publisher, needed - 1);
        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(token, IRiskySurface.approve.selector);

        vm.prank(publisher);
        vm.expectRevert(
            abi.encodeWithSelector(
                PinRegistry.InsufficientUnlockedBond.selector, needed, needed - 1
            )
        );
        registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));
    }

    // --- revocation and unbonding ---

    function test_revokeMakesPinNonLive() public {
        fundPublisher(publisher, 10_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.startPrank(publisher);
        bytes32 pinId = registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));
        registry.revoke(pinId);
        vm.stopPrank();

        assertEq(registry.liveSkillHash(pinId), bytes32(0));
    }

    function test_revokeIsOneWay() public {
        fundPublisher(publisher, 10_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.startPrank(publisher);
        bytes32 pinId = registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));
        registry.revoke(pinId);

        vm.expectRevert(PinRegistry.AlreadyRevoked.selector);
        registry.revoke(pinId);
        vm.stopPrank();
    }

    function test_onlyPublisherCanRevoke() public {
        fundPublisher(publisher, 10_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(publisher);
        bytes32 pinId = registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));

        vm.prank(other);
        vm.expectRevert(PinRegistry.NotPublisher.selector);
        registry.revoke(pinId);
    }

    /// The attack this delay exists for: ship a hostile update, drain users,
    /// revoke, and pull the bond out before anyone can claim against it.
    function test_bondCannotBeReclaimedImmediatelyAfterRevoking() public {
        fundPublisher(publisher, 10_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);

        vm.startPrank(publisher);
        bytes32 pinId = registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));
        registry.revoke(pinId);

        vm.expectRevert(
            abi.encodeWithSelector(
                PinRegistry.UnbondingNotElapsed.selector, uint64(block.timestamp) + UNBONDING_DELAY
            )
        );
        registry.reclaimBond(pinId);
        vm.stopPrank();
    }

    function test_bondIsReclaimableAfterTheDelay() public {
        fundPublisher(publisher, 10_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);

        vm.startPrank(publisher);
        bytes32 pinId = registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));
        uint256 locked = registry.lockedBond(publisher);
        registry.revoke(pinId);

        vm.warp(block.timestamp + UNBONDING_DELAY);
        registry.reclaimBond(pinId);
        vm.stopPrank();

        assertEq(registry.lockedBond(publisher), 0);
        assertEq(registry.unlockedBond(publisher), 10_000 * ONE_AUSD);
        assertTrue(locked > 0);
    }

    function test_bondCannotBeReclaimedTwice() public {
        fundPublisher(publisher, 10_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);

        vm.startPrank(publisher);
        bytes32 pinId = registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));
        registry.revoke(pinId);
        vm.warp(block.timestamp + UNBONDING_DELAY);
        registry.reclaimBond(pinId);

        vm.expectRevert(PinRegistry.NothingToReclaim.selector);
        registry.reclaimBond(pinId);
        vm.stopPrank();
    }

    function test_liveBondCannotBeReclaimed() public {
        fundPublisher(publisher, 10_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);

        vm.startPrank(publisher);
        bytes32 pinId = registry.publish(defaultParams(keccak256("v1"), 0, targets, selectors));

        vm.expectRevert(PinRegistry.PinNotRevoked.selector);
        registry.reclaimBond(pinId);
        vm.stopPrank();
    }

    // --- invariants ---

    /// Locked bond must never exceed deposited bond, or the registry is claiming
    /// collateral it does not hold.
    function testFuzz_lockedNeverExceedsBalance(uint8 pinCount, uint96 deposit) public {
        vm.assume(deposit > 0 && deposit < type(uint96).max / 2);
        uint256 n = uint256(pinCount) % 8;
        fundPublisher(publisher, deposit);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);

        for (uint256 i = 0; i < n; ++i) {
            vm.prank(publisher);
            try registry.publish(defaultParams(keccak256(abi.encode(i)), 0, targets, selectors)) {}
            catch {}
        }

        assertLe(registry.lockedBond(publisher), registry.bondBalance(publisher));
    }

    function testFuzz_quoteBondIsMonotonicInBreadth(uint8 a, uint8 b) public view {
        vm.assume(a < b);
        assertLt(registry.quoteBond(a, 0, false), registry.quoteBond(b, 0, false));
    }
}


