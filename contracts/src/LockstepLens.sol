// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IIdentityRegistry, IReputationRegistry} from "./interfaces/IERC8004.sol";
import {PinRegistry} from "./PinRegistry.sol";

/// @notice Minimal view of a Lockstep-guarded account, used to test reviewer eligibility.
interface IGuardedAccount {
    function isPinApproved(bytes32 pinId) external view returns (bool);
}

/// @title LockstepLens
/// @notice Sybil-resistant reputation for skill publishers, built on ERC-8004
///         through its own interfaces rather than around them.
///
/// ## Why this exists
///
/// ERC-8004's Reputation Registry lets **anyone** call `giveFeedback`. The spec is
/// candid about the consequence: its Security Considerations state that Sybil
/// attacks can inflate a fake agent's reputation, that the protocol's contribution
/// is publishing signals in a shared schema, and that it expects third parties to
/// build systems which score the reviewers.
///
/// The signature of `getSummary` encodes that expectation as a requirement:
/// `clientAddresses` must be non-empty, because unfiltered aggregation is
/// explicitly described as spam-vulnerable.
///
/// **So the standard demands a curated client set and does not provide one.** This
/// contract provides it, and does so without forking, extending, or re-deploying
/// any ERC-8004 registry. It is a pure reader.
///
/// ## What makes a reviewer eligible
///
/// A candidate is eligible for a publisher's score only if it currently approves at
/// least one live pin from that publisher. That is checkable on chain and it means
/// something concrete: the reviewer has that publisher's exact code authorised
/// against its own funds. Rating a publisher you never trusted with money costs
/// nothing and says nothing; this filter removes exactly that class of signal.
///
/// Sybil resistance is therefore economic rather than absolute. Manufacturing a
/// reviewer requires standing up an account, delegating it to the guard, and
/// approving the publisher's pin — a real on-chain commitment rather than a free
/// write.
///
/// ## Known limitation, stated rather than implied
///
/// True exposure weighting — weighting a reviewer by the value it actually put at
/// risk with this publisher — needs a per-(account, pin) execution record. Writing
/// one would put a cross-contract SSTORE in the guard's hot path, which costs every
/// user on every transaction to improve a view. It is deferred deliberately, and
/// `weightedScore` returns an unweighted summary over the eligible set until then.
/// Do not describe this as exposure-weighted.
///
/// ## The registries this reads are upgradeable, and that is a trust assumption
///
/// Measured on Monad testnet 10143 rather than assumed. Both ERC-8004 registries are
/// ERC-1967 proxies with byte-identical 130-byte proxy code, and the address they
/// forward to lives in storage slot
/// `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`
/// (`keccak256("eip1967.proxy.implementation") - 1`). The admin slot is zero and
/// `proxiableUUID()` on each implementation returns that same slot, so these are UUPS
/// proxies, not transparent ones — the upgrade authority is `owner()` on the proxy
/// itself. At the time of writing both registries return the **same** owner, and that
/// address has no code, so it is a single EOA.
///
/// The consequence is worth stating in the contract that depends on it: a project whose
/// thesis is that code identity should be pinned reads its reputation input from a
/// contract whose code can be replaced by one key. `identity` and `reputation` are
/// `immutable` here, so this contract will always point at the same *proxy* — which is
/// the addressing behaviour you want, and is also exactly what makes the implementation
/// behind it mutable without this contract noticing.
///
/// This is not a defect in ERC-8004 and not something a reader can fix. It is a
/// dependency to declare, and the reason `LockstepLens` is a pure reader with no
/// authority of its own: nothing this contract holds can be taken by an upgrade
/// downstream of it, and the worst an upgrade can do is make a score wrong, not move
/// money. Enforcement never consults it. Verification commands are in the README.
contract LockstepLens {
    PinRegistry public immutable pins;
    IIdentityRegistry public immutable identity;
    IReputationRegistry public immutable reputation;

    /// @dev Bounds the candidate loop so a caller cannot force an unbounded
    ///      external-call fan-out through a view that UIs call on every render.
    uint256 public constant MAX_CANDIDATES = 256;

    error TooManyCandidates(uint256 count, uint256 max);
    error NoEligibleClients();
    error EmptyPinSet();

    constructor(
        PinRegistry pins_,
        IIdentityRegistry identity_,
        IReputationRegistry reputation_
    ) {
        pins = pins_;
        identity = identity_;
        reputation = reputation_;
    }

    /// @notice Whether `account` currently approves any of `pinIds` that is still live.
    /// @dev Tolerates accounts that are not delegated to a guard: a failing
    ///      `isPinApproved` staticcall means "not eligible", not a revert. Otherwise a
    ///      single undelegated candidate address would break the whole query.
    function isEligibleReviewer(address account, bytes32[] calldata pinIds)
        public
        view
        returns (bool)
    {
        if (pinIds.length == 0) revert EmptyPinSet();

        for (uint256 i = 0; i < pinIds.length; ++i) {
            bytes32 pinId = pinIds[i];
            // A revoked or slashed pin proves nothing about present trust.
            if (pins.liveSkillHash(pinId) == bytes32(0)) continue;

            (bool ok, bytes memory ret) = address(account).staticcall(
                abi.encodeCall(IGuardedAccount.isPinApproved, (pinId))
            );
            if (ok && ret.length == 32 && abi.decode(ret, (bool))) return true;
        }
        return false;
    }

    /// @notice Filters candidates down to reviewers with a verifiable stake.
    /// @param candidates addresses to consider, typically from an indexer or from
    ///        `IReputationRegistry.getClients`. Untrusted: every entry is verified.
    /// @param pinIds live pins belonging to the publisher under review.
    function eligibleReviewers(address[] calldata candidates, bytes32[] calldata pinIds)
        public
        view
        returns (address[] memory eligible)
    {
        if (candidates.length > MAX_CANDIDATES) {
            revert TooManyCandidates(candidates.length, MAX_CANDIDATES);
        }

        address[] memory buffer = new address[](candidates.length);
        uint256 found = 0;
        for (uint256 i = 0; i < candidates.length; ++i) {
            address candidate = candidates[i];
            if (candidate == address(0)) continue;
            // Skip duplicates: a repeated address would count one reviewer twice.
            bool seen = false;
            for (uint256 j = 0; j < found; ++j) {
                if (buffer[j] == candidate) {
                    seen = true;
                    break;
                }
            }
            if (seen) continue;
            if (!isEligibleReviewer(candidate, pinIds)) continue;
            buffer[found] = candidate;
            found += 1;
        }

        eligible = new address[](found);
        for (uint256 i = 0; i < found; ++i) {
            eligible[i] = buffer[i];
        }
    }

    /// @notice ERC-8004 summary computed over verified reviewers only.
    ///
    /// This is the whole point: the same registry, the same `getSummary` call, but
    /// with a client set that cost something to join. Compare against
    /// `unfilteredScore` to see what the filter removes.
    ///
    /// @return count number of eligible feedback entries
    /// @return summaryValue aggregate value as the registry computes it
    /// @return summaryValueDecimals fixed-point scale of `summaryValue`
    /// @return reviewers the client set actually used, so a caller can audit it
    function weightedScore(
        uint256 agentId,
        address[] calldata candidates,
        bytes32[] calldata pinIds,
        string calldata tag1,
        string calldata tag2
    )
        external
        view
        returns (
            uint64 count,
            int128 summaryValue,
            uint8 summaryValueDecimals,
            address[] memory reviewers
        )
    {
        reviewers = eligibleReviewers(candidates, pinIds);
        // `getSummary` requires a non-empty client set. Surface the real reason
        // rather than letting the registry revert opaquely.
        if (reviewers.length == 0) revert NoEligibleClients();

        (count, summaryValue, summaryValueDecimals) =
            reputation.getSummary(agentId, reviewers, tag1, tag2);
    }

    /// @notice The naive aggregation, for comparison only.
    /// @dev Exists so a UI can display both numbers side by side. This is the
    ///      figure a Sybil attacker can move at will, and seeing it next to the
    ///      filtered score is the clearest possible argument for the filter.
    ///      Never use this as a trust signal.
    function unfilteredScore(uint256 agentId, string calldata tag1, string calldata tag2)
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)
    {
        address[] memory allClients = reputation.getClients(agentId);
        if (allClients.length == 0) revert NoEligibleClients();
        return reputation.getSummary(agentId, allClients, tag1, tag2);
    }

    /// @notice Resolves an ERC-8004 agent to the address that receives its payments.
    /// @dev Falls back to the token owner when no `agentWallet` is set, matching the
    ///      spec's rule that the reserved key starts as the owner and is cleared on
    ///      transfer.
    function publisherOf(uint256 agentId) external view returns (address) {
        address wallet = identity.getAgentWallet(agentId);
        return wallet == address(0) ? identity.ownerOf(agentId) : wallet;
    }
}
