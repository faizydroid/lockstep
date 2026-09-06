// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "./Fixtures.sol";
import {IIdentityRegistry, IReputationRegistry} from "../src/interfaces/IERC8004.sol";
import {LockstepGuard} from "../src/LockstepGuard.sol";
import {IGuardedAccount, LockstepLens} from "../src/LockstepLens.sol";

/// @notice A contract that claims to approve every pin ever created.
///
/// The Sybil this suite previously did not have. Every fake reviewer in the original tests was a
/// bare EOA, which has no code, so the eligibility staticcall failed and the candidate was rejected
/// — and that only ever proved an address which cannot answer is not counted.
///
/// This one answers. It is the whole attack: `isPinApproved` is a one-line view, so the entire Sybil
/// filter could be defeated by deploying this and cloning it to as many addresses as an attacker
/// cares to fund.
contract LyingApprover {
    function isPinApproved(bytes32) external pure returns (bool) {
        return true;
    }
}

/// @notice A guard-shaped implementation that is not *the* guard.
///
/// An account genuinely delegated under EIP-7702, with real code, a real designator and a real
/// approval — to the wrong implementation. Stands for the `gator create` handover the guard's own
/// docstring warns about, and for an attacker who deploys their own permissive "guard" and delegates
/// to that instead.
contract RivalImplementation {
    mapping(bytes32 => bool) public approved;

    function approvePin(bytes32 pinId) external {
        approved[pinId] = true;
    }

    function isPinApproved(bytes32 pinId) external view returns (bool) {
        return approved[pinId];
    }
}

/// @notice Minimal ERC-8004 stand-ins.
///
/// Real registries sit at CREATE2-deterministic addresses, so on a live chain the
/// lens points at those. These mocks reproduce only the two behaviours under test:
/// `getSummary` aggregating over a caller-supplied client set, and `getClients`
/// returning everyone who ever wrote feedback.
contract MockReputationRegistry is IReputationRegistry {
    mapping(uint256 => address[]) internal clients;
    mapping(uint256 => mapping(address => int128)) public score;
    mapping(uint256 => mapping(address => bool)) internal known;

    function giveFeedback(uint256 agentId, address client, int128 value) external {
        if (!known[agentId][client]) {
            known[agentId][client] = true;
            clients[agentId].push(client);
        }
        score[agentId][client] = value;
    }

    function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata, string calldata)
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)
    {
        int256 total = 0;
        for (uint256 i = 0; i < clientAddresses.length; ++i) {
            if (!known[agentId][clientAddresses[i]]) continue;
            total += score[agentId][clientAddresses[i]];
            count += 1;
        }
        summaryValue = count == 0 ? int128(0) : int128(total / int256(uint256(count)));
        summaryValueDecimals = 0;
    }

    function getClients(uint256 agentId) external view returns (address[] memory) {
        return clients[agentId];
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

contract MockIdentityRegistry is IIdentityRegistry {
    mapping(uint256 => address) public owners;
    mapping(uint256 => address) public wallets;

    function setAgent(uint256 agentId, address owner, address wallet) external {
        owners[agentId] = owner;
        wallets[agentId] = wallet;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        return owners[agentId];
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return wallets[agentId];
    }

    function getMetadata(uint256, string calldata) external pure returns (bytes memory) {
        return "";
    }
}

contract LockstepLensTest is Fixtures {
    LockstepLens internal lens;
    MockReputationRegistry internal repRegistry;
    MockIdentityRegistry internal idRegistry;

    address internal publisher;
    address internal router = address(0x1111);
    bytes4 internal constant SWAP = bytes4(keccak256("swap(uint256)"));

    uint256 internal constant AGENT_ID = 42;

    bytes32 internal livePin;
    bytes32 internal revokedPin;

    /// Honest reviewers: real accounts, delegated, approving the publisher's pin.
    uint256 internal constant HONEST_A_PK = 0xA1;
    uint256 internal constant HONEST_B_PK = 0xB2;
    address payable internal honestA;
    address payable internal honestB;

    /// Sybils: contracts that wrote feedback and claim to approve the pin, but carry no delegation.
    ///
    /// @dev Deliberately not bare EOAs. An EOA has no code, so the eligibility staticcall fails and
    ///      the candidate is rejected for a reason that has nothing to do with the filter — which is
    ///      how a suite of thirteen passing tests coexisted with a filter that did not filter. A
    ///      Sybil that cannot speak is not a test of whether lies are believed.
    address internal sybil1;
    address internal sybil2;
    address internal sybil3;

    /// Kept separately, for the one test that is specifically about an address which cannot answer.
    address internal plainEoa = address(0xDEAD9);

    function setUp() public {
        publisher = makeAddr("publisher");
        deployCore();
        repRegistry = new MockReputationRegistry();
        idRegistry = new MockIdentityRegistry();
        lens = new LockstepLens(registry, idRegistry, repRegistry, address(guardImpl));

        idRegistry.setAgent(AGENT_ID, publisher, publisher);

        fundPublisher(publisher, 100_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.startPrank(publisher);
        livePin =
            registry.publish(publishParams("lens", "1.0.0", keccak256("live"), 0, targets, selectors));
        revokedPin =
            registry.publish(publishParams("lens", "0.9.0", keccak256("dead"), 0, targets, selectors));
        registry.revoke(revokedPin);
        vm.stopPrank();

        honestA = _delegatedApprover(HONEST_A_PK, livePin);
        honestB = _delegatedApprover(HONEST_B_PK, livePin);

        sybil1 = address(new LyingApprover());
        sybil2 = address(new LyingApprover());
        sybil3 = address(new LyingApprover());
    }

    /// Creates an account delegated to the guard that approves `pinId`.
    function _delegatedApprover(uint256 pk, bytes32 pinId) internal returns (address payable) {
        address payable account = payable(vm.addr(pk));
        vm.signAndAttachDelegation(address(guardImpl), pk);
        vm.prank(account);
        LockstepGuard(account).approvePin(pinId);
        return account;
    }

    function _pinSet(bytes32 pinId) internal pure returns (bytes32[] memory set) {
        set = new bytes32[](1);
        set[0] = pinId;
    }

    /// @dev The code an account carries when delegated to `implementation`.
    function _designator(address implementation) internal pure returns (bytes memory) {
        return abi.encodePacked(hex"ef0100", implementation);
    }

    // --- the delegation check ---

    /// The premise the whole check rests on: EIP-7702 sets a delegated account's code to the
    /// designator, and the code-inspection opcodes see *that*, not the implementation's code. If
    /// `EXTCODEHASH` followed the delegation instead, `isGuardedAccount` would be comparing against
    /// the wrong thing and would reject every real account.
    function test_extcodehashSeesTheDesignatorNotTheImplementation() public view {
        assertEq(honestA.code, _designator(address(guardImpl)), "designator installed");
        assertEq(honestA.codehash, keccak256(_designator(address(guardImpl))));
        assertTrue(
            honestA.codehash != address(guardImpl).codehash,
            "codehash must not follow the delegation"
        );
    }

    function test_delegatedAccountIsRecognisedAsGuarded() public view {
        assertTrue(lens.isGuardedAccount(honestA));
    }

    function test_undelegatedEoaIsNotGuarded() public view {
        assertFalse(lens.isGuardedAccount(sybil1));
    }

    /// The attack this fix exists for. A contract that returns `true` from `isPinApproved` used to
    /// be a fully eligible reviewer for the cost of one deployment.
    function test_contractClaimingApprovalIsNotEligible() public {
        address liar = address(new LyingApprover());

        // The lie itself works: the staticcall the lens makes returns true.
        assertTrue(IGuardedAccount(liar).isPinApproved(livePin), "the stub does claim approval");

        // And it buys nothing, because the stub carries its own code rather than a designator.
        assertFalse(lens.isGuardedAccount(liar));
        assertFalse(lens.isEligibleReviewer(liar, _pinSet(livePin)));
    }

    /// Cloning the stub is the cheap part, so prove the filter holds across a full candidate list
    /// rather than one address.
    function test_anArmyOfLyingStubsIsFilteredOut() public {
        address[] memory candidates = new address[](33);
        for (uint256 i = 0; i < 32; ++i) {
            candidates[i] = address(new LyingApprover());
        }
        candidates[32] = honestA;

        address[] memory eligible = lens.eligibleReviewers(candidates, _pinSet(livePin));

        assertEq(eligible.length, 1, "only the real account survives");
        assertEq(eligible[0], honestA);
    }

    /// Real delegation, real approval, wrong implementation. This is the `gator create` handover the
    /// guard's docstring warns about: the approval is genuine but nothing enforces it, so it must
    /// not count as a reviewer's stake either.
    function test_accountDelegatedToARivalImplementationIsNotEligible() public {
        RivalImplementation rival = new RivalImplementation();
        uint256 pk = 0xE5;
        address payable account = payable(vm.addr(pk));
        vm.signAndAttachDelegation(address(rival), pk);
        vm.prank(account);
        RivalImplementation(account).approvePin(livePin);

        // Genuinely delegated, and it genuinely says yes.
        assertEq(account.code, _designator(address(rival)), "delegated to the rival");
        assertTrue(RivalImplementation(account).isPinApproved(livePin));

        assertFalse(lens.isGuardedAccount(account));
        assertFalse(lens.isEligibleReviewer(account, _pinSet(livePin)));
    }

    /// Re-delegating away from the guard must revoke eligibility, even though the approval is still
    /// sitting in the account's storage. Storage survives a delegation change; enforcement does not.
    function test_eligibilityIsLostWhenAnAccountIsRedelegatedAway() public {
        assertTrue(lens.isEligibleReviewer(honestA, _pinSet(livePin)));

        // Re-delegated to something maximally permissive, so the account still answers "yes" and the
        // only thing that changed is which implementation is answering. Delegating to a
        // *stricter* rival would make this test pass for the wrong reason — an empty mapping at a
        // different storage slot — and prove nothing about the check under test.
        LyingApprover elsewhere = new LyingApprover();
        vm.signAndAttachDelegation(address(elsewhere), HONEST_A_PK);

        assertTrue(IGuardedAccount(honestA).isPinApproved(livePin), "the account still says yes");
        assertFalse(
            lens.isEligibleReviewer(honestA, _pinSet(livePin)),
            "an approval nothing enforces is not a reviewer's stake"
        );
    }

    function test_theLensItselfIsNotAGuardedAccount() public view {
        assertFalse(lens.isGuardedAccount(address(lens)));
        assertFalse(lens.isGuardedAccount(address(registry)));
        // Not even the guard implementation: it holds code, not a designator naming itself.
        assertFalse(lens.isGuardedAccount(address(guardImpl)));
    }

    function test_guardIsRecordedAndCannotBeZero() public {
        assertEq(lens.guard(), address(guardImpl));
        assertEq(lens.DESIGNATOR_LENGTH(), 23);

        vm.expectRevert(LockstepLens.ZeroGuard.selector);
        new LockstepLens(registry, idRegistry, repRegistry, address(0));
    }

    // --- eligibility ---

    function test_accountApprovingALivePinIsEligible() public view {
        assertTrue(lens.isEligibleReviewer(honestA, _pinSet(livePin)));
    }

    /// A plain address that never delegated cannot be a reviewer. The staticcall
    /// fails and must be read as "not eligible" rather than reverting the query.
    function test_undelegatedAddressIsNotEligibleAndDoesNotRevert() public view {
        assertFalse(lens.isEligibleReviewer(plainEoa, _pinSet(livePin)));
    }

    function test_delegatedAccountNotApprovingIsNotEligible() public {
        address payable stranger = _delegatedApprover(0xC3, keccak256("unrelated"));

        assertFalse(lens.isEligibleReviewer(stranger, _pinSet(livePin)));
    }

    /// A revoked pin proves nothing about present trust.
    function test_approvingOnlyARevokedPinIsNotEligible() public {
        address payable holder = _delegatedApprover(0xD4, revokedPin);

        assertFalse(lens.isEligibleReviewer(holder, _pinSet(revokedPin)));
    }

    function test_emptyPinSetIsRejected() public {
        bytes32[] memory none = new bytes32[](0);

        vm.expectRevert(LockstepLens.EmptyPinSet.selector);
        lens.isEligibleReviewer(honestA, none);
    }

    // --- filtering ---

    function test_filtersSybilsOutOfTheClientSet() public view {
        address[] memory candidates = new address[](5);
        candidates[0] = sybil1;
        candidates[1] = honestA;
        candidates[2] = sybil2;
        candidates[3] = honestB;
        candidates[4] = sybil3;

        address[] memory eligible = lens.eligibleReviewers(candidates, _pinSet(livePin));

        assertEq(eligible.length, 2);
        assertEq(eligible[0], honestA);
        assertEq(eligible[1], honestB);
    }

    function test_deduplicatesRepeatedCandidates() public view {
        address[] memory candidates = new address[](3);
        candidates[0] = honestA;
        candidates[1] = honestA;
        candidates[2] = honestA;

        assertEq(lens.eligibleReviewers(candidates, _pinSet(livePin)).length, 1);
    }

    function test_skipsZeroAddress() public view {
        address[] memory candidates = new address[](2);
        candidates[0] = address(0);
        candidates[1] = honestA;

        assertEq(lens.eligibleReviewers(candidates, _pinSet(livePin)).length, 1);
    }

    /// A view that UIs call on every render must not accept an unbounded fan-out of
    /// external calls.
    function test_candidateListIsBounded() public {
        uint256 tooMany = lens.MAX_CANDIDATES() + 1;
        address[] memory candidates = new address[](tooMany);

        vm.expectRevert(
            abi.encodeWithSelector(
                LockstepLens.TooManyCandidates.selector, tooMany, lens.MAX_CANDIDATES()
            )
        );
        lens.eligibleReviewers(candidates, _pinSet(livePin));
    }

    // --- the demo: what the filter is worth ---

    /// The headline. Three Sybils rate the publisher perfectly and two real users
    /// rate it poorly. Naive aggregation reports near-perfect; the filtered score
    /// reports the truth. Same registry, same `getSummary` call.
    function test_sybilSpamMovesTheNaiveScoreAndNotTheFilteredOne() public {
        repRegistry.giveFeedback(AGENT_ID, honestA, 40);
        repRegistry.giveFeedback(AGENT_ID, honestB, 30);
        repRegistry.giveFeedback(AGENT_ID, sybil1, 100);
        repRegistry.giveFeedback(AGENT_ID, sybil2, 100);
        repRegistry.giveFeedback(AGENT_ID, sybil3, 100);

        (uint64 naiveCount, int128 naiveScore,) = lens.unfilteredScore(AGENT_ID, "", "");

        address[] memory candidates = repRegistry.getClients(AGENT_ID);
        (uint64 count, int128 score,, address[] memory reviewers) =
            lens.weightedScore(AGENT_ID, candidates, _pinSet(livePin), "", "");

        // Naive: (40 + 30 + 100 + 100 + 100) / 5 = 74
        assertEq(naiveCount, 5);
        assertEq(naiveScore, 74);

        // Filtered: (40 + 30) / 2 = 35
        assertEq(count, 2);
        assertEq(score, 35);
        assertEq(reviewers.length, 2);

        // The attacker moved the naive figure by more than double.
        assertGt(naiveScore, score * 2);
    }

    /// Adding more Sybils must not move the filtered score at all.
    function test_moreSybilsDoNotMoveTheFilteredScore() public {
        repRegistry.giveFeedback(AGENT_ID, honestA, 40);
        repRegistry.giveFeedback(AGENT_ID, honestB, 30);

        address[] memory before = repRegistry.getClients(AGENT_ID);
        (, int128 scoreBefore,,) =
            lens.weightedScore(AGENT_ID, before, _pinSet(livePin), "", "");

        for (uint160 i = 1; i <= 50; ++i) {
            repRegistry.giveFeedback(AGENT_ID, address(i + 0x9000), 100);
        }

        address[] memory after_ = repRegistry.getClients(AGENT_ID);
        (uint64 count, int128 scoreAfter,,) =
            lens.weightedScore(AGENT_ID, after_, _pinSet(livePin), "", "");

        assertEq(scoreAfter, scoreBefore);
        assertEq(count, 2);
    }

    function test_revertsWhenNoReviewerQualifies() public {
        repRegistry.giveFeedback(AGENT_ID, sybil1, 100);
        address[] memory candidates = repRegistry.getClients(AGENT_ID);

        vm.expectRevert(LockstepLens.NoEligibleClients.selector);
        lens.weightedScore(AGENT_ID, candidates, _pinSet(livePin), "", "");
    }

    // --- identity ---

    function test_resolvesTheAgentWallet() public view {
        assertEq(lens.publisherOf(AGENT_ID), publisher);
    }

    /// The spec clears `agentWallet` on transfer, so it must fall back to the owner.
    function test_fallsBackToOwnerWhenNoWalletIsSet() public {
        idRegistry.setAgent(AGENT_ID, publisher, address(0));

        assertEq(lens.publisherOf(AGENT_ID), publisher);
    }
}

