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

    /// @dev `V1` and `V2` are version *strings* now, not precomputed ids. `publish` derives the id
    ///      from the label, so a test that supplied its own id would be testing a code path the
    ///      registry no longer has.
    string internal constant NAME = "kuru-quote";
    string internal constant V1 = "1.0.0";
    string internal constant V2 = "1.0.1";

    /// The ids the registry derives for those labels. Asked of the registry in `setUp` rather than
    /// hardcoded, so an assertion cannot pass against a stale copy of the derivation.
    bytes32 internal v1Id;
    bytes32 internal v2Id;

    bytes32 internal constant HONEST = keccak256("honest bytes");
    bytes32 internal constant HOSTILE = keccak256("hostile bytes");

    function setUp() public {
        publisher = makeAddr("publisher");
        challenger = makeAddr("challenger");
        deployCore();
        fundPublisher(publisher, 100_000 * ONE_AUSD);
        v1Id = registry.computeVersionId(NAME, V1);
        v2Id = registry.computeVersionId(NAME, V2);
    }

    function _publish(bytes32 skillHash, string memory version) internal returns (bytes32) {
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(publisher);
        return registry.publish(publishParams(NAME, version, skillHash, 0, targets, selectors));
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

    /// `publish` no longer accepts a version id, so there is no `ZeroVersionId` case left to test.
    /// What replaces it is this: the id a pin records must be the one derived from the label the
    /// publisher stated in public.
    function test_publishRecordsTheDerivedVersionId() public {
        bytes32 pinId = _publish(HONEST, V1);
        assertEq(registry.getPin(pinId).versionId, registry.computeVersionId(NAME, V1));
        assertEq(registry.getPin(pinId).versionId, v1Id);
    }

    // --- label rules ---
    //
    // Deriving the id closes the "pick any id" hole but not the "pick any label" hole one layer up.
    // `"kuru-quote "` and a Cyrillic `о` both render as the skill a user already trusts while
    // hashing to an unrelated id, which would reopen exactly the evasion the derivation closed.

    function test_publishRejectsEmptyName() public {
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(publisher);
        vm.expectRevert(PinRegistry.LabelEmpty.selector);
        registry.publish(publishParams("", V1, HONEST, 0, targets, selectors));
    }

    function test_publishRejectsEmptyVersion() public {
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(publisher);
        vm.expectRevert(PinRegistry.LabelEmpty.selector);
        registry.publish(publishParams(NAME, "", HONEST, 0, targets, selectors));
    }

    function test_publishRejectsTrailingSpace() public {
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(publisher);
        vm.expectRevert(PinRegistry.LabelNotPrintableAscii.selector);
        registry.publish(publishParams("kuru-quote ", V1, HONEST, 0, targets, selectors));
    }

    /// The homoglyph case. `"kuru-qu\u043Ete"` differs from `"kuru-quote"` by one Cyrillic `о` and
    /// is visually identical in most fonts.
    function test_publishRejectsNonAsciiLookalike() public {
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(publisher);
        vm.expectRevert(PinRegistry.LabelNotPrintableAscii.selector);
        registry.publish(publishParams("kuru-qu\u043Ete", V1, HONEST, 0, targets, selectors));
    }

    function test_publishRejectsControlCharacters() public {
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(publisher);
        vm.expectRevert(PinRegistry.LabelNotPrintableAscii.selector);
        registry.publish(publishParams("kuru\nquote", V1, HONEST, 0, targets, selectors));
    }

    function test_publishRejectsOverlongLabel() public {
        uint256 max = registry.MAX_LABEL_BYTES();
        string memory tooLong = _repeat("a", max + 1);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(publisher);
        vm.expectRevert(
            abi.encodeWithSelector(PinRegistry.LabelTooLong.selector, max + 1, max)
        );
        registry.publish(publishParams(tooLong, V1, HONEST, 0, targets, selectors));
    }

    function test_publishAcceptsALabelExactlyAtTheLimit() public {
        uint256 max = registry.MAX_LABEL_BYTES();
        string memory atLimit = _repeat("a", max);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(publisher);
        bytes32 pinId =
            registry.publish(publishParams(atLimit, V1, HONEST, 0, targets, selectors));
        assertEq(registry.getPin(pinId).versionId, registry.computeVersionId(atLimit, V1));
    }

    /// `isValidLabel` exists so publisher tooling can refuse a name before spending gas. It must
    /// agree with what `publish` actually enforces, or it is worse than nothing.
    function test_isValidLabelAgreesWithPublish() public view {
        assertTrue(registry.isValidLabel("kuru-quote"));
        assertTrue(registry.isValidLabel("1.0.0"));
        assertTrue(registry.isValidLabel("!"));
        assertTrue(registry.isValidLabel("~"));
        assertFalse(registry.isValidLabel(""));
        assertFalse(registry.isValidLabel("kuru quote"));
        assertFalse(registry.isValidLabel("kuru-quote "));
        assertFalse(registry.isValidLabel(" kuru-quote"));
        assertFalse(registry.isValidLabel("kuru\tquote"));
        assertFalse(registry.isValidLabel("kuru-qu\u043Ete"));
        assertFalse(registry.isValidLabel(_repeat("a", registry.MAX_LABEL_BYTES() + 1)));
    }

    function _repeat(string memory unit, uint256 times) internal pure returns (string memory out) {
        for (uint256 i = 0; i < times; ++i) {
            out = string.concat(out, unit);
        }
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
        vm.expectRevert(abi.encodeWithSelector(PinRegistry.NoEquivocation.selector, v1Id, v2Id));
        registry.slashEquivocation(a, b);
    }

    function test_differentPublishersAreNotEquivocation() public {
        address other = makeAddr("other");
        fundPublisher(other, 100_000 * ONE_AUSD);

        bytes32 a = _publish(HONEST, V1);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(other);
        bytes32 b = registry.publish(publishParams(NAME, V1, HOSTILE, 0, targets, selectors));

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
        bytes32 a = registry.publish(publishParams(NAME, V1, HONEST, 0, targets, selectors));
        vm.warp(block.timestamp + 1 days);
        bytes32 b = registry.publish(publishParams(NAME, V1, HOSTILE, 0, targets, selectors));
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
        registry.publish(publishParams(NAME, V2, keccak256("third"), 0, targets, selectors));
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

    string internal constant NAME = "skill";
    string internal constant V1 = "1.0.0";
    string internal constant V2 = "2.0.0";

    bytes32 internal v1Id;
    bytes32 internal v2Id;

    function setUp() public {
        publisher = makeAddr("publisher");
        challenger = makeAddr("challenger");
        deployCore();
        fundPublisher(publisher, 100_000 * ONE_AUSD);
        v1Id = registry.computeVersionId(NAME, V1);
        v2Id = registry.computeVersionId(NAME, V2);
    }

    function _publish(bytes32 skillHash, string memory version) internal returns (bytes32) {
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.prank(publisher);
        return registry.publish(publishParams(NAME, version, skillHash, 0, targets, selectors));
    }

    function test_versionPinCountTracksClaimsPerVersion() public {
        _publish(keccak256("a"), V1);
        assertEq(registry.versionPinCount(publisher, v1Id), 1);

        _publish(keccak256("b"), V1);
        assertEq(registry.versionPinCount(publisher, v1Id), 2);

        _publish(keccak256("c"), V2);
        assertEq(registry.versionPinCount(publisher, v2Id), 1);
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

        vm.expectRevert(abi.encodeWithSelector(PinRegistry.EquivocationUnresolved.selector, v1Id));
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
    ///
    /// @dev The final assertion here used to be the opposite: it asserted the surviving pin stayed
    ///      frozen after the slash, with the comment "the contradiction stands". That was the bug,
    ///      written down as intent. The contradiction does not stand once it has been answered — the
    ///      guilty bond has been paid out and no further challenge against it is possible — so
    ///      holding the honest claim's collateral confiscated it and gave it to nobody.
    function test_theSurvivingPinUnfreezesOnceTheContradictionIsAnswered() public {
        bytes32 first = _publish(keccak256("honest"), V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 second = _publish(keccak256("hostile"), V1);

        uint256 firstBond = registry.getPin(first).requiredBond;
        uint256 secondBond = registry.getPin(second).requiredBond;
        assertEq(registry.lockedBond(publisher), firstBond + secondBond);
        assertEq(registry.versionPinCount(publisher, v1Id), 2, "two unresolved claims");

        vm.prank(challenger);
        registry.slashEquivocation(first, second);

        // Only the guilty pin's bond left the ledger.
        assertEq(registry.lockedBond(publisher), firstBond);
        assertLe(registry.lockedBond(publisher), registry.bondBalance(publisher));
        assertEq(registry.versionPinCount(publisher, v1Id), 1, "the contradiction was answered");

        // The slash revoked both pins, so the survivor's unbonding clock is already running.
        vm.warp(block.timestamp + UNBONDING_DELAY + 1);
        vm.prank(publisher);
        registry.reclaimBond(first);

        assertTrue(registry.bondReclaimed(first));
        assertEq(registry.lockedBond(publisher), 0, "no stranded collateral");
    }

    // --- the honest rebuild ---
    //
    // A publisher whose build is not byte-reproducible can equivocate without meaning to: a
    // different compiler, a timestamp baked into a bundle, a lockfile that resolved differently.
    // Under the old rule both bonds froze permanently and there was no path out at all.

    function test_anAccidentalContradictionFreezesBothBonds() public {
        bytes32 first = _publish(keccak256("build-one"), V1);
        bytes32 rebuild = _publish(keccak256("build-two"), V1);

        vm.startPrank(publisher);
        registry.revoke(first);
        registry.revoke(rebuild);
        vm.warp(block.timestamp + UNBONDING_DELAY + 1);

        vm.expectRevert(abi.encodeWithSelector(PinRegistry.EquivocationUnresolved.selector, v1Id));
        registry.reclaimBond(first);
        vm.expectRevert(abi.encodeWithSelector(PinRegistry.EquivocationUnresolved.selector, v1Id));
        registry.reclaimBond(rebuild);
        vm.stopPrank();
    }

    /// The escape hatch, and the reason there is no separate entry point for it: challenging is
    /// permissionless, so the publisher can prove their own contradiction. They forfeit the later
    /// claim's bond and recover the earlier one.
    function test_aPublisherCanResolveTheirOwnAccidentalContradiction() public {
        bytes32 first = _publish(keccak256("build-one"), V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 rebuild = _publish(keccak256("build-two"), V1);

        uint256 firstBond = registry.getPin(first).requiredBond;
        uint256 rebuildBond = registry.getPin(rebuild).requiredBond;

        vm.prank(publisher);
        registry.slashEquivocation(first, rebuild);

        assertTrue(registry.getPin(rebuild).slashed, "the mistake was forfeited");
        assertEq(registry.lockedBond(publisher), firstBond);

        vm.warp(block.timestamp + UNBONDING_DELAY + 1);
        vm.prank(publisher);
        registry.reclaimBond(first);

        assertEq(registry.lockedBond(publisher), 0, "the honest bond came back");
        assertGt(rebuildBond, 0);
    }

    /// The cost of self-reporting, stated as a test so the number cannot drift from the docstring.
    /// The publisher recovers the challenger reward because they submitted the proof; the
    /// `slashRecipient` share is the real penalty. A fresh EOA achieves the same thing, so this is
    /// the honest figure whether or not the publisher uses their own address.
    function test_selfReportingCostsOnlyTheSlashRecipientShare() public {
        bytes32 first = _publish(keccak256("build-one"), V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 rebuild = _publish(keccak256("build-two"), V1);
        uint256 bond = registry.getPin(rebuild).requiredBond;

        vm.prank(publisher);
        uint256 reward = registry.slashEquivocation(first, rebuild);

        uint256 expectedReward = (bond * CHALLENGER_REWARD_BPS) / 10_000;
        assertEq(reward, expectedReward);
        assertEq(ausd.balanceOf(publisher), expectedReward, "the reward came back to the offender");
        assertEq(ausd.balanceOf(slashRecipient), bond - expectedReward, "the actual penalty");
    }

    /// Three claims, one slash. Two contradictions remain unanswered, so the freeze must hold.
    /// Decrementing to "no contradiction" after a single slash would be the same bug inverted.
    function test_aSingleSlashDoesNotClearThreeWayEquivocation() public {
        bytes32 first = _publish(keccak256("one"), V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 second = _publish(keccak256("two"), V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 third = _publish(keccak256("three"), V1);
        assertEq(registry.versionPinCount(publisher, v1Id), 3);

        vm.prank(challenger);
        registry.slashEquivocation(first, third);
        assertEq(registry.versionPinCount(publisher, v1Id), 2, "one answered, one still open");

        vm.warp(block.timestamp + UNBONDING_DELAY + 1);
        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(PinRegistry.EquivocationUnresolved.selector, v1Id));
        registry.reclaimBond(first);

        // Answer the remaining one and the survivor is free.
        vm.prank(challenger);
        registry.slashEquivocation(first, second);
        assertEq(registry.versionPinCount(publisher, v1Id), 1);

        vm.warp(block.timestamp + UNBONDING_DELAY + 1);
        vm.prank(publisher);
        registry.reclaimBond(first);
        assertTrue(registry.bondReclaimed(first));
    }

    /// The property the freeze exists for, restated against the fix: a bond that is still exposed to
    /// a possible challenge must never be reclaimable.
    function test_answeringOneVersionDoesNotUnfreezeAnother() public {
        _publish(keccak256("a1"), V1);
        vm.warp(block.timestamp + 1 days);
        bytes32 a2 = _publish(keccak256("a2"), V1);

        bytes32 b1 = _publish(keccak256("b1"), V2);
        vm.warp(block.timestamp + 1 days);
        bytes32 b2 = _publish(keccak256("b2"), V2);

        vm.prank(challenger);
        registry.slashEquivocation(b1, b2);

        // V2 is answered; V1 is not.
        assertEq(registry.versionPinCount(publisher, v2Id), 1);
        assertEq(registry.versionPinCount(publisher, v1Id), 2);

        vm.startPrank(publisher);
        registry.revoke(a2);
        vm.warp(block.timestamp + UNBONDING_DELAY + 1);
        vm.expectRevert(abi.encodeWithSelector(PinRegistry.EquivocationUnresolved.selector, v1Id));
        registry.reclaimBond(a2);
        vm.stopPrank();
    }
}
