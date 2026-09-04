// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "./Fixtures.sol";
import {IIdentityRegistry, IReputationRegistry} from "../src/interfaces/IERC8004.sol";
import {LockstepGuard} from "../src/LockstepGuard.sol";
import {LockstepLens} from "../src/LockstepLens.sol";

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

    /// Sybils: plain addresses that wrote feedback but never trusted the code.
    address internal sybil1 = address(0xDEAD1);
    address internal sybil2 = address(0xDEAD2);
    address internal sybil3 = address(0xDEAD3);

    function setUp() public {
        publisher = makeAddr("publisher");
        deployCore();
        repRegistry = new MockReputationRegistry();
        idRegistry = new MockIdentityRegistry();
        lens = new LockstepLens(registry, idRegistry, repRegistry);

        idRegistry.setAgent(AGENT_ID, publisher, publisher);

        fundPublisher(publisher, 100_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(router, SWAP);
        vm.startPrank(publisher);
        livePin = registry.publish(keccak256("live"), keccak256("v1"), 0, targets, selectors);
        revokedPin = registry.publish(keccak256("dead"), keccak256("v0"), 0, targets, selectors);
        registry.revoke(revokedPin);
        vm.stopPrank();

        honestA = _delegatedApprover(HONEST_A_PK, livePin);
        honestB = _delegatedApprover(HONEST_B_PK, livePin);
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

    // --- eligibility ---

    function test_accountApprovingALivePinIsEligible() public view {
        assertTrue(lens.isEligibleReviewer(honestA, _pinSet(livePin)));
    }

    /// A plain address that never delegated cannot be a reviewer. The staticcall
    /// fails and must be read as "not eligible" rather than reverting the query.
    function test_undelegatedAddressIsNotEligibleAndDoesNotRevert() public view {
        assertFalse(lens.isEligibleReviewer(sybil1, _pinSet(livePin)));
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

