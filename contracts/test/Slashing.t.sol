// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "./Fixtures.sol";
import {PinRegistry} from "../src/PinRegistry.sol";

/// @notice Equivocation slashing.
///
/// The attack under test: ship `1.0.0`, collect approvals, then quietly republish
/// `1.0.0` with different bytes, hoping the version string carries the trust that
/// was earned by the original. Both claims are signed and on chain, and they cannot
/// both be true, so anyone can prove the contradiction and take the bond.
contract SlashingTest is Fixtures {
    address internal publisher;
    address internal challenger;
    address internal router = address(0x1111);

    bytes4 internal constant SWAP = bytes4(keccak256("swap(uint256)"));

    bytes32 internal constant V1 = keccak256("kuru-quote@1.0.0");
    bytes32 internal constant V2 = keccak256("kuru-quote@1.0.1");

    bytes32 internal constant HONEST = keccak256("honest bytes");
    bytes32 internal constant HOSTILE = keccak256("hostile bytes");

    function setUp() public {
        publisher = makeAddr("publisher");
        challenger = makeAddr("challenger");
        deployCore();
        fundPublisher(publisher, 100_000 * ONE_AUSD);
    }

    function _publish(bytes32 skillHash, bytes32 versionId) internal returns (bytes32) {
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(publisher);
        return registry.publish(skillHash, versionId, 0, targets, selectors);
    }

    // --- version identity ---

    function test_versionIdIsDeterministic() public view {
        assertEq(
            registry.computeVersionId("kuru-quote", "1.0.0"),
            registry.computeVersionId("kuru-quote", "1.0.0")
        );
    }

    /// Concatenating name and version would let ("ab","c") and ("a","bc") collide
    /// into one version, so two unrelated skills could be made to look like
    /// equivocation. `abi.encode` length-prefixes and prevents it.
    function test_versionIdResistsNameVersionBoundaryCollision() public view {
        assertTrue(
            registry.computeVersionId("ab", "c") != registry.computeVersionId("a", "bc"),
            "name/version boundary collision"
        );
    }

    function test_publishRejectsZeroVersionId() public {
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(publisher);
        vm.expectRevert(PinRegistry.ZeroVersionId.selector);
        registry.publish(HONEST, bytes32(0), 0, targets, selectors);
    }

    // --- the offence ---

    function test_slashesTheLaterConflictingClaim() public {
        bytes32 first = _publish(HONEST, V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 second = _publish(HOSTILE, V1);

        uint256 bondOfSecond = registry.getPin(second).requiredBond;
        uint256 lockedBefore = registry.lockedBond(publisher);

        vm.prank(challenger);
        uint256 reward = registry.slashEquivocation(first, second);

        // Half to the challenger, half to the slash recipient.
        assertEq(reward, (bondOfSecond * CHALLENGER_REWARD_BPS) / 10_000);
        assertEq(ausd.balanceOf(challenger), reward);
        assertEq(ausd.balanceOf(slashRecipient), bondOfSecond - reward);

        // The later pin is the guilty one: the earlier claim is what users approved
        // against, so the offence is the contradiction introduced afterwards.
        assertTrue(registry.getPin(second).slashed);
        assertFalse(registry.getPin(first).slashed);

        // Commitment released and balance reduced together, or the publisher would
        // be left with phantom locked bond.
        assertEq(registry.lockedBond(publisher), lockedBefore - bondOfSecond);
    }

    /// Both versions must stop working while the contradiction stands. A user cannot
    /// be expected to know which of two conflicting claims was the honest one.
    function test_bothPinsAreRevoked() public {
        bytes32 first = _publish(HONEST, V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 second = _publish(HOSTILE, V1);

        vm.prank(challenger);
        registry.slashEquivocation(first, second);

        assertEq(registry.liveSkillHash(first), bytes32(0));
        assertEq(registry.liveSkillHash(second), bytes32(0));
    }

    function test_anyoneCanChallenge() public {
        bytes32 first = _publish(HONEST, V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 second = _publish(HOSTILE, V1);

        address passerby = makeAddr("passerby");
        vm.prank(passerby);
        registry.slashEquivocation(first, second);

        assertGt(ausd.balanceOf(passerby), 0);
    }

    /// Argument order must not change the outcome; a challenger should not have to
    /// know which pin came first.
    function test_argumentOrderDoesNotMatter() public {
        bytes32 first = _publish(HONEST, V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 second = _publish(HOSTILE, V1);

        vm.prank(challenger);
        registry.slashEquivocation(second, first);

        assertTrue(registry.getPin(second).slashed);
        assertFalse(registry.getPin(first).slashed);
    }

    function test_emitsSlashed() public {
        bytes32 first = _publish(HONEST, V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 second = _publish(HOSTILE, V1);
        uint256 bond = registry.getPin(second).requiredBond;

        vm.expectEmit(true, true, true, true, address(registry));
        emit PinRegistry.Slashed(
            second, publisher, challenger, bond, (bond * CHALLENGER_REWARD_BPS) / 10_000
        );

        vm.prank(challenger);
        registry.slashEquivocation(first, second);
    }

    // --- what is not an offence ---

    /// Publishing a genuinely new version is normal and must never be slashable.
    /// If it were, no publisher could ever ship an update.
    function test_differentVersionsAreNotEquivocation() public {
        bytes32 a = _publish(HONEST, V1);
        bytes32 b = _publish(HOSTILE, V2);

        vm.prank(challenger);
        vm.expectRevert(abi.encodeWithSelector(PinRegistry.NoEquivocation.selector, V1, V2));
        registry.slashEquivocation(a, b);
    }

    function test_differentPublishersAreNotEquivocation() public {
        address other = makeAddr("other");
        fundPublisher(other, 100_000 * ONE_AUSD);

        bytes32 a = _publish(HONEST, V1);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(other);
        bytes32 b = registry.publish(HOSTILE, V1, 0, targets, selectors);

        vm.prank(challenger);
        vm.expectRevert(
            abi.encodeWithSelector(PinRegistry.NotSamePublisher.selector, publisher, other)
        );
        registry.slashEquivocation(a, b);
    }

    function test_samePinIsNotAProof() public {
        bytes32 a = _publish(HONEST, V1);

        vm.prank(challenger);
        vm.expectRevert(PinRegistry.SamePin.selector);
        registry.slashEquivocation(a, a);
    }

    function test_unknownPinCannotBeSlashed() public {
        bytes32 a = _publish(HONEST, V1);

        vm.prank(challenger);
        vm.expectRevert(PinRegistry.PinUnknown.selector);
        registry.slashEquivocation(a, keccak256("nope"));
    }

    /// Revoking does not undo the contradiction. Otherwise a publisher caught
    /// equivocating could revoke and escape the bond.
    function test_revokingDoesNotPreventSlashing() public {
        bytes32 first = _publish(HONEST, V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 second = _publish(HOSTILE, V1);

        vm.prank(publisher);
        registry.revoke(second);

        vm.prank(challenger);
        registry.slashEquivocation(first, second);

        assertTrue(registry.getPin(second).slashed);
    }

    // --- double spend of the bond ---

    function test_cannotSlashTwice() public {
        bytes32 first = _publish(HONEST, V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 second = _publish(HOSTILE, V1);

        vm.prank(challenger);
        registry.slashEquivocation(first, second);

        vm.prank(challenger);
        vm.expectRevert(PinRegistry.PinAlreadySlashed.selector);
        registry.slashEquivocation(first, second);
    }

    /// Without this the publisher reclaims a commitment already paid to a
    /// challenger, driving `lockedBond` below the true committed amount and letting
    /// them over-publish against collateral that no longer exists.
    function test_slashedBondCannotBeReclaimed() public {
        bytes32 first = _publish(HONEST, V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 second = _publish(HOSTILE, V1);

        vm.prank(challenger);
        registry.slashEquivocation(first, second);

        vm.warp(block.timestamp + UNBONDING_DELAY + 1);
        vm.prank(publisher);
        vm.expectRevert(PinRegistry.PinAlreadySlashed.selector);
        registry.reclaimBond(second);
    }

    /// A slash reduces spendable bond, so capacity to publish must shrink with it.
    function test_slashingReducesPublishingCapacity() public {
        // Fund a fresh publisher with room for exactly two pins.
        address tight = makeAddr("tight");
        uint256 one = registry.quoteBond(1, 0, false);
        fundPublisher(tight, one * 2);

        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.startPrank(tight);
        bytes32 a = registry.publish(HONEST, V1, 0, targets, selectors);
        vm.warp(block.timestamp + 1 days);
        bytes32 b = registry.publish(HOSTILE, V1, 0, targets, selectors);
        vm.stopPrank();

        vm.prank(challenger);
        registry.slashEquivocation(a, b);

        assertEq(registry.bondBalance(tight), one);
        assertEq(registry.lockedBond(tight), one);
        assertEq(registry.unlockedBond(tight), 0);

        // No spare bond, so nothing further can be published.
        vm.prank(tight);
        vm.expectRevert(
            abi.encodeWithSelector(PinRegistry.InsufficientUnlockedBond.selector, one, 0)
        );
        registry.publish(keccak256("third"), V2, 0, targets, selectors);
    }

    // --- invariant ---

    /// The accounting identity the whole bond system rests on.
    function testFuzz_lockedNeverExceedsBalanceAcrossSlashing(uint8 seed) public {
        bytes32 first = _publish(HONEST, V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 second = _publish(HOSTILE, V1);

        if (seed % 2 == 0) {
            vm.prank(publisher);
            registry.revoke(first);
        }

        vm.prank(challenger);
        registry.slashEquivocation(first, second);

        assertLe(registry.lockedBond(publisher), registry.bondBalance(publisher));
    }
}

/// @notice The revoke-and-run defence.
///
/// Found by the invariant campaign, not by inspection. A 7-day unbonding delay looks
/// sufficient until you notice that equivocation stays provable from immutable
/// on-chain data forever: a publisher could revoke, wait out the delay, reclaim, and
/// only then become unslashable. The subsequent slash then released the same locked
/// bond a second time and broke the accounting identity outright.
contract EquivocationFreezeTest is Fixtures {
    address internal publisher;
    address internal challenger;
    address internal router = address(0x1111);
    bytes4 internal constant SWAP = bytes4(keccak256("swap(uint256)"));

    bytes32 internal constant V1 = keccak256("skill@1.0.0");
    bytes32 internal constant V2 = keccak256("skill@2.0.0");

    function setUp() public {
        publisher = makeAddr("publisher");
        challenger = makeAddr("challenger");
        deployCore();
        fundPublisher(publisher, 100_000 * ONE_AUSD);
    }

    function _publish(bytes32 skillHash, bytes32 versionId) internal returns (bytes32) {
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(publisher);
        return registry.publish(skillHash, versionId, 0, targets, selectors);
    }

    function test_versionPinCountTracksClaimsPerVersion() public {
        _publish(keccak256("a"), V1);
        assertEq(registry.versionPinCount(publisher, V1), 1);

        _publish(keccak256("b"), V1);
        assertEq(registry.versionPinCount(publisher, V1), 2);

        _publish(keccak256("c"), V2);
        assertEq(registry.versionPinCount(publisher, V2), 1);
    }

    /// The attack, blocked. Reclaiming would remove the collateral that backs the
    /// contradiction still sitting on chain.
    function test_cannotReclaimWhileAContradictionStands() public {
        bytes32 first = _publish(keccak256("honest"), V1);
        vm.warp(block.timestamp + 1 days);
        _publish(keccak256("hostile"), V1);

        vm.startPrank(publisher);
        registry.revoke(first);
        vm.warp(block.timestamp + UNBONDING_DELAY + 1);

        vm.expectRevert(abi.encodeWithSelector(PinRegistry.EquivocationUnresolved.selector, V1));
        registry.reclaimBond(first);
        vm.stopPrank();
    }

    /// A single honest claim per version must still be reclaimable, or no publisher
    /// could ever recover capital from a retired release.
    function test_singleClaimVersionsRemainReclaimable() public {
        bytes32 pinId = _publish(keccak256("only"), V1);

        vm.startPrank(publisher);
        registry.revoke(pinId);
        vm.warp(block.timestamp + UNBONDING_DELAY + 1);
        registry.reclaimBond(pinId);
        vm.stopPrank();

        assertTrue(registry.bondReclaimed(pinId));
    }

    /// The freeze is scoped to the offending version. Unrelated releases from the
    /// same publisher must not be held hostage.
    function test_freezeDoesNotAffectOtherVersions() public {
        _publish(keccak256("honest"), V1);
        _publish(keccak256("hostile"), V1);
        bytes32 clean = _publish(keccak256("clean"), V2);

        vm.startPrank(publisher);
        registry.revoke(clean);
        vm.warp(block.timestamp + UNBONDING_DELAY + 1);
        registry.reclaimBond(clean);
        vm.stopPrank();

        assertTrue(registry.bondReclaimed(clean));
    }

    /// The full attack path, end to end: the bond is still there when the challenger
    /// arrives, however long they take.
    function test_slashStillWorksAfterTheDelayHasLongPassed() public {
        bytes32 first = _publish(keccak256("honest"), V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 second = _publish(keccak256("hostile"), V1);

        vm.prank(publisher);
        registry.revoke(second);

        // Long past the unbonding delay. Under the old design the bond would be gone.
        vm.warp(block.timestamp + 365 days);

        vm.prank(challenger);
        uint256 reward = registry.slashEquivocation(first, second);

        assertGt(reward, 0, "bond should still have been available to slash");
        assertEq(ausd.balanceOf(challenger), reward);
    }

    /// Accounting must survive the interleaving that originally broke it.
    function test_lockedBondStaysConsistentAcrossSlashThenReclaimAttempt() public {
        bytes32 first = _publish(keccak256("honest"), V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 second = _publish(keccak256("hostile"), V1);

        uint256 firstBond = registry.getPin(first).requiredBond;
        uint256 secondBond = registry.getPin(second).requiredBond;
        assertEq(registry.lockedBond(publisher), firstBond + secondBond);

        vm.prank(challenger);
        registry.slashEquivocation(first, second);

        // Only the guilty pin's bond left the ledger.
        assertEq(registry.lockedBond(publisher), firstBond);
        assertLe(registry.lockedBond(publisher), registry.bondBalance(publisher));

        // And the innocent pin's bond is still frozen: the contradiction stands.
        vm.warp(block.timestamp + UNBONDING_DELAY + 1);
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(PinRegistry.EquivocationUnresolved.selector, V1));
        registry.reclaimBond(first);
    }
}
