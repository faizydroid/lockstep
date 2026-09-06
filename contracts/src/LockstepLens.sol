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
/// Two things, and the first one used to be missing.
///
///   1. The candidate's code is an EIP-7702 delegation designator pointing at the
///      canonical `LockstepGuard`.
///   2. Through that guard, the candidate currently approves at least one live pin
///      belonging to the publisher under review.
///
/// ## Why the first check exists: this filter did not filter
///
/// Eligibility was decided by staticcalling `isPinApproved(pinId)` on the candidate
/// and believing the answer. Nothing established that the answer came from a guard.
///
/// `isPinApproved` is a one-line view. Any address can implement it, and returning
/// `true` unconditionally is a contract small enough to deploy for pocket change and
/// clone to as many addresses as an attacker wants. So the entire Sybil defence —
/// the contract's stated reason to exist, the thing the demo puts on screen next to
/// `unfilteredScore` — could be defeated by a stub with one function in it. Worse
/// than a missing feature: a *claimed* one, which invites people to rely on it.
///
/// The test suite did not catch this because every Sybil in it was a bare EOA. An
/// EOA has no code, so the staticcall fails and the candidate is rejected — which
/// looks like the filter working, and proves only that an address which does not
/// answer is not counted. It never asked what happens when an address answers and
/// lies.
///
/// `LockstepGuard.guardStorageSlot` already stated the rule that closes this: a
/// consumer must check the account's code equals `0xef0100 || guard` before treating
/// an approval as live. That note was written for accounts silently re-delegated
/// away from the guard, but it is the same check, and this contract — the one
/// consumer where it decides a trust score — did not do it.
///
/// `isGuardedAccount` now does, via `EXTCODEHASH`, before any staticcall. A stub
/// cannot pass it: the only 23-byte code that hashes to the expected value is a
/// designator naming this exact guard, and an account can only acquire one by having
/// its own key sign an EIP-7702 authorisation.
///
/// ## What that leaves, stated exactly
///
/// Sybil resistance is economic, not absolute, and the honest bound is narrower than
/// the one this file used to claim. A forged reviewer now costs: a distinct EOA, a
/// signed 7702 authorisation delegating it to the guard, and one `approvePin` write.
/// That is real and it is per-reviewer, but it is a few tens of thousands of gas —
/// not a bond. A funded attacker can still manufacture reviewers; they can no longer
/// do it with one contract and a loop.
///
/// What the check does buy is that every counted reviewer is an account that put the
/// publisher's exact code in its own signing path. Closing the remaining gap needs
/// weighting by value actually exposed, which is the deferred work described below.
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

    /// @notice The guard implementation an eligible reviewer must be delegated to.
    ///
    /// @dev Immutable and singular on purpose. If this were a set, or settable, the question "is
    ///      this account guarded" would have an answer that depends on who last changed the answer.
    ///      A new guard implementation means a new lens.
    address public immutable guard;

    /// @dev `keccak256(0xef0100 || guard)` — the EXTCODEHASH an account carries when, and only
    ///      when, it is delegated to `guard` under EIP-7702.
    ///
    ///      Precomputed because it is compared once per candidate and the candidate list can hold
    ///      `MAX_CANDIDATES` entries.
    bytes32 private immutable _guardDesignatorHash;

    /// @dev Length of an EIP-7702 delegation designator: the three-byte `0xef0100` prefix plus one
    ///      twenty-byte address. Not used for the comparison itself, which is a hash, but recorded
    ///      because the number is the reason a stub cannot impersonate a delegation: there is no
    ///      room in twenty-three bytes for code that does anything.
    uint256 public constant DESIGNATOR_LENGTH = 23;

    /// @dev Bounds the candidate loop so a caller cannot force an unbounded
    ///      external-call fan-out through a view that UIs call on every render.
    uint256 public constant MAX_CANDIDATES = 256;

    error TooManyCandidates(uint256 count, uint256 max);
    error NoEligibleClients();
    error EmptyPinSet();
    error ZeroGuard();

    constructor(
        PinRegistry pins_,
        IIdentityRegistry identity_,
        IReputationRegistry reputation_,
        address guard_
    ) {
        // Fails closed rather than loudly if left unset — no account would ever match a designator
        // naming the zero address — and failing closed silently is worse than not deploying. Every
        // score would read as zero eligible reviewers and look like an absence of reviewers.
        if (guard_ == address(0)) revert ZeroGuard();
        pins = pins_;
        identity = identity_;
        reputation = reputation_;
        guard = guard_;
        _guardDesignatorHash = keccak256(abi.encodePacked(hex"ef0100", guard_));
    }

    /// @notice Whether `account` is currently delegated to `guard` under EIP-7702.
    ///
    /// @dev This is the check that makes an `isPinApproved` answer worth reading. EIP-7702 sets a
    ///      delegated account's *code* to `0xef0100 || implementation`, and specifies that the
    ///      code-inspection opcodes see that designator rather than the implementation's code — so
    ///      `EXTCODEHASH` is a complete, single-opcode test of which implementation an account
    ///      answers as.
    ///
    ///      Uses `codehash` rather than reading `account.code` and comparing bytes, for two
    ///      reasons. It is one opcode instead of a memory copy. And a candidate list is untrusted
    ///      input: comparing bytes would copy each candidate's code into memory, so a caller could
    ///      point all 256 slots at 24 kB contracts and make a view that UIs call on every render
    ///      pay for 6 MB of memory expansion. `EXTCODEHASH` costs the same whatever the code is.
    ///
    ///      An account with no code hashes to zero here, so undelegated EOAs are rejected without a
    ///      special case.
    function isGuardedAccount(address account) public view returns (bool) {
        return account.codehash == _guardDesignatorHash;
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
        // Before the loop, and before any staticcall. An account that is not delegated to the guard
        // cannot have a meaningful answer to `isPinApproved`, only a convenient one.
        if (!isGuardedAccount(account)) return false;

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
