// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PinRegistry} from "./PinRegistry.sol";

/// @title LockstepGuard
/// @notice EIP-7702 delegate that binds every fund-moving call an agent makes to
///         an exact, user-approved skill version.
///
/// ## Threat model - read before changing anything here
///
/// EIP-7702 adds code to an EOA. It does **not** intercept transactions signed by
/// that EOA's own key. A key holder can always sign a plain transaction straight
/// to any target and the delegate code never runs.
///
/// The consequence is structural: **the agent must never hold the account's root
/// key.** If it does, prevention is impossible and only after-the-fact slashing
/// remains. So the account splits into two roles:
///
///   - the account itself, whose key the user controls (a passkey-derived EOA
///     works well here) and which holds the funds;
///   - one or more executors, which are the agent's own addresses, authorised in
///     storage, holding no funds, and paying their own gas.
///
/// An executor can only move value by calling `execute` on the account, which
/// forces it through the checks below.
///
/// ## What this contract proves, and what it does not
///
/// Trustless, verified from calldata regardless of what any off-chain component
/// claims:
///   - the target is on the pin's allowlist
///   - the selector is on the pin's allowlist
///   - the batch's **total** native value is within the pin's ceiling
///   - the batch holds no more than `MAX_CALLS` calls
///   - the pin is one the account holder explicitly approved
///   - the pin has not been revoked by its publisher
///   - no call in the batch targets the account itself, so a batch cannot reach this contract's
///     own policy setters (see the note in `execute`)
///
/// ## The value ceiling used to be per call, and that bounded nothing
///
/// This list previously read "the native value is within the pin's per-call ceiling", and
/// the loop below checked exactly that: every call, against the ceiling, with nothing
/// bounding how many calls a batch could contain. So a compromised executor moved any
/// amount it liked in a single transaction by splitting it — a pin with a 1 MON ceiling
/// authorised 1 MON, or 100 MON as a hundred calls, or as much as the block gas limit
/// allowed. The ceiling was a formatting rule, not a limit, and it was published as a
/// guarantee.
///
/// The total is now summed across the batch and checked once, before anything executes.
///
/// What that does and does not buy, precisely: it bounds the value one *transaction* under
/// a pin can move. It does not bound lifetime spend, because an executor can send another
/// transaction. Bounding spend over time is a rate limit, it needs to live with whatever
/// holds the funds, and MetaMask's Agent Wallet already does it well. The two compose: this
/// contract makes the per-transaction number honest, and a wallet allowance bounds how many
/// transactions there can be. Neither alone is sufficient and this file should not pretend
/// otherwise.
///
/// One caveat, stated rather than guarded against. A batch gets its own budget, so nesting
/// batches would each get one. Nesting requires a call target to re-enter `execute`, which
/// requires that target to be an authorised executor — a state the account holder has to
/// create deliberately, and one in which they have already handed an arbitrary contract the
/// right to spend. A reentrancy guard would put an SSTORE in the hot path of every honest
/// transaction to change nothing about that position, so there isn't one.
///
/// Attested, not proven: which skill actually produced the call. The runtime
/// computes the skill hash off-chain and reports it. A compromised runtime can
/// report an honest hash while executing something else. What the chain provides
/// is a non-repudiable record binding this transaction to a claimed skill
/// version, which turns a false claim into provable fraud against a bond. That
/// is an economic guarantee, not a cryptographic one, and the write-up must say
/// so plainly.
///
/// Out of scope entirely: indirect prompt injection from content the agent reads,
/// and any harm that does not move funds. This contract bounds financial blast
/// radius. It is not a general agent sandbox.
contract LockstepGuard {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    /// @custom:storage-location erc7201:lockstep.guard.v1
    /// @dev Deliberately holds no counters. An execution counter cost roughly 3k
    ///      gas of SSTORE on every single agent transaction to serve a view that
    ///      `SkillExecuted` already gives indexers for free. Nothing goes in here
    ///      that the hot path does not need to read.
    struct GuardStorage {
        mapping(bytes32 => bool) approvedPin;
        mapping(address => bool) authorizedExecutor;
    }

    /// @dev ERC-7201 namespaced slot.
    ///
    /// Under 7702 the delegate writes into the *account's* storage. If the user
    /// later delegates to a different implementation, naive sequential slots
    /// would collide and one contract could silently reinterpret another's
    /// state - here, potentially reading an attacker-controlled slot as an
    /// approval. Namespacing removes that class of bug.
    ///
    /// keccak256(abi.encode(uint256(keccak256("lockstep.guard.v1")) - 1)) & ~0xff
    bytes32 private constant GUARD_STORAGE_SLOT =
        0x723bc0536d6998736ca58b10278e77528d6552c6336394144a42647181e0f200;

    PinRegistry public immutable registry;

    event PinApproved(bytes32 indexed pinId);
    event PinUnapproved(bytes32 indexed pinId);
    event ExecutorAuthorized(address indexed executor);
    event ExecutorRevoked(address indexed executor);

    /// @notice A batch executed under an approved pin.
    event SkillExecuted(
        bytes32 indexed pinId, bytes32 indexed skillHash, address indexed executor, uint256 callCount
    );

    /// Note on observing blocked attempts.
    ///
    /// There is deliberately no `RugPullBlocked` event. An earlier version emitted
    /// one immediately before reverting, which is worthless: the revert rolls the
    /// log back, so no indexer ever receives it, and gas measurement showed the
    /// dead emit made rejection cost *more* than a successful execution.
    ///
    /// `SkillHashMismatch(attested, pinned)` carries the same two values in the
    /// revert reason, which survives in the transaction trace. The watcher reads
    /// blocked attempts from reverted-transaction traces rather than from logs.

    error NotSelf();
    error NotAuthorizedExecutor(address caller);
    error PinNotApproved(bytes32 pinId);
    error SkillHashMismatch(bytes32 attested, bytes32 pinned);
    error CapabilityNotDeclared(address target, bytes4 selector);
    /// @dev Replaced `ValueExceedsCeiling(value, ceiling)`. The old name and its arguments described
    ///      a single call's value, which is no longer what is checked; keeping it would have left
    ///      every decoded revert reason claiming a per-call violation.
    error BatchValueExceedsCeiling(uint256 total, uint256 ceiling);
    error EmptyBatch();
    error TooManyCalls(uint256 count, uint256 max);
    error CallReverted(uint256 index);
    /// @dev A batch named the account itself as a call target. See the note in `execute`.
    error SelfCallRefused(uint256 index);

    /// @dev Largest batch `execute` will accept.
    ///
    ///      Bounds the loop. Being honest about what that is worth: it does not bound token drain,
    ///      because value is not how tokens move — an allowance-based transfer carries `value == 0`,
    ///      and parsing token amounts is deliberately out of scope for this contract. What the cap
    ///      does is keep a batch's cost predictable, keep `SkillExecuted`'s `callCount` a meaningful
    ///      receipt rather than an unbounded number, and remove an unbounded caller-controlled loop
    ///      of external calls from the signing path of a funded account.
    ///
    ///      32 is well above real batches — a multi-hop swap is two or three calls, a DCA batch is
    ///      five to ten — and far below anything that makes the loop the interesting part of the
    ///      transaction.
    uint256 public constant MAX_CALLS = 32;

    constructor(PinRegistry registry_) {
        registry = registry_;
    }

    /// @notice The ERC-7201 slot this guard keeps its state in.
    /// @dev Exposed so indexers and wallet UIs can read an account's approvals
    ///      directly via `eth_getStorageAt` without an RPC call per key, and so a
    ///      test can assert the derivation matches the documented namespace.
    ///
    ///      **A storage read alone is not evidence that an account is protected.**
    ///      Delegation under EIP-7702 replaces an account's *code*, not its storage, and
    ///      an account carries exactly one delegation indicator. So delegating an account
    ///      that was using this guard to some other implementation — `gator create` and
    ///      any other 7702 upgrade flow do exactly this — leaves every approval sitting
    ///      untouched in this slot while nothing enforces them. Reading storage then
    ///      reports an account as guarded when it is not, and the handover is silent.
    ///
    ///      Any consumer of this slot must also check that the account's code equals
    ///      `0xef0100 || address(this)` before treating an approval as live. Established
    ///      by test, not by inspection: see `Eip7702ExclusivityTest`.
    function guardStorageSlot() external pure returns (bytes32) {
        return GUARD_STORAGE_SLOT;
    }

    function _s() private pure returns (GuardStorage storage s) {
        bytes32 slot = GUARD_STORAGE_SLOT;
        assembly {
            s.slot := slot
        }
    }

    /// @dev Only the account itself. Under 7702 `address(this)` is the account, so
    ///      this permits exactly one caller: a transaction the account holder
    ///      signed to their own address. Executors cannot change policy - an agent
    ///      must never be able to widen its own permissions.
    ///
    ///      That sentence used to end "deliberately cannot", stated absolutely, and it was
    ///      **conditionally false**. This modifier closes the direct path only: an executor calling
    ///      `authorizeExecutor` at the account is refused with `NotSelf`, and two tests covered
    ///      exactly that. Neither covered the nested path, where `execute` makes a call *from* the
    ///      account to the account and so satisfies this check on the inner call. The claim is true
    ///      again because `execute` now refuses the account as a call target, not because this
    ///      modifier was ever sufficient on its own. The reasoning is recorded there.
    // forge-lint: disable-next-line(unwrapped-modifier-logic)
    modifier onlySelf() {
        // Deliberately not extracted into an internal function. The lint suggests that to shrink
        // bytecode where a modifier is applied many times; this one guards four policy setters that
        // are called rarely, and the check is a single comparison. Inlining it keeps the whole
        // authorisation decision visible at the point of use, which matters more here than a few
        // bytes of code size in a contract that sits in the signing path of funded accounts.
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    // --- policy, account holder only ---

    function approvePin(bytes32 pinId) external onlySelf {
        _s().approvedPin[pinId] = true;
        emit PinApproved(pinId);
    }

    function unapprovePin(bytes32 pinId) external onlySelf {
        _s().approvedPin[pinId] = false;
        emit PinUnapproved(pinId);
    }

    function authorizeExecutor(address executor) external onlySelf {
        _s().authorizedExecutor[executor] = true;
        emit ExecutorAuthorized(executor);
    }

    function revokeExecutor(address executor) external onlySelf {
        _s().authorizedExecutor[executor] = false;
        emit ExecutorRevoked(executor);
    }

    // --- views ---

    function isPinApproved(bytes32 pinId) external view returns (bool) {
        return _s().approvedPin[pinId];
    }

    function isExecutorAuthorized(address executor) external view returns (bool) {
        return _s().authorizedExecutor[executor];
    }

    // --- hot path ---

    /// @notice Execute a batch on behalf of an approved skill version.
    /// @param pinId The pin the account holder approved.
    /// @param attestedSkillHash Skill hash the runtime computed for the code it loaded.
    /// @param calls Calls to perform, each checked against the pin. At most `MAX_CALLS`, and their
    ///        values must sum to no more than the pin's ceiling.
    function execute(bytes32 pinId, bytes32 attestedSkillHash, Call[] calldata calls) external {
        GuardStorage storage s = _s();

        if (msg.sender != address(this) && !s.authorizedExecutor[msg.sender]) {
            revert NotAuthorizedExecutor(msg.sender);
        }
        if (calls.length == 0) revert EmptyBatch();
        if (calls.length > MAX_CALLS) revert TooManyCalls(calls.length, MAX_CALLS);
        if (!s.approvedPin[pinId]) revert PinNotApproved(pinId);

        // One combined read instead of three separate CALLs. `pinnedHash` is zero
        // when the pin is unknown or the publisher revoked it, and a valid
        // attestation can never be zero, so both states fail closed below.
        bytes4 firstSelector = _selectorOf(calls[0].data);
        (bytes32 pinnedHash, uint256 ceiling, bool firstAllowed) =
            registry.verify(pinId, calls[0].target, firstSelector);

        if (pinnedHash != attestedSkillHash || pinnedHash == bytes32(0)) {
            revert SkillHashMismatch(attestedSkillHash, pinnedHash);
        }

        // Summed and checked before the first call, not accumulated as the batch runs.
        //
        // Both orderings are equally safe against partial settlement, because a revert anywhere
        // unwinds the whole batch either way. Checking first is better for two other reasons: it
        // costs the executor nothing beyond the calldata scan when a batch is over budget, instead
        // of burning gas on calls that are about to be undone; and it means no value has moved at
        // the moment the budget is decided, so there is no window in which a target could observe
        // the batch half-applied and no question about what a reentrant call would see.
        // Checked arithmetic is load-bearing here, not incidental. An `unchecked` block would let an
        // attacker pick values summing to a small number modulo 2^256 — `type(uint256).max` and `2`
        // sum to 1 — so the total would sit under the ceiling while each call moved a fortune.
        // Verified by removing the check: the budget passed and only the account's balance stopped
        // the batch. See `test_theValueTotalCannotBeWrappedAroundTheCeiling`.
        //
        // The same pre-flight pass refuses the account as a call target, and that check closes a
        // confirmed privilege escalation rather than guarding a hypothetical one.
        //
        // `onlySelf` requires `msg.sender == address(this)`, which under 7702 means a transaction
        // the owner signed to their own address. But `execute` makes its calls *from* the account,
        // so a call whose target is the account satisfies `onlySelf` on the inner call. An executor
        // could therefore route `authorizeExecutor(attacker)` or `approvePin(anything)` through a
        // batch and change policy without the owner signing anything — the exact thing this
        // contract's documentation said was impossible. It needed an approved pin that declared
        // `(accountAddress, policySelector)`, so it was narrow and targeted rather than broadly
        // exploitable, and it was still reachable. Established by test, not by inspection: see
        // `SelfCallEscalationTest`.
        //
        // Refusing *every* self-target rather than blacklisting the four policy selectors is
        // deliberate. A selector blacklist has to be maintained in step with the contract's own
        // surface, so any function added later is permitted until someone remembers this list; the
        // target check fails closed for all of them at once. Nothing legitimate is lost — the guard
        // exposes no other function worth batching, and a plain value transfer to self is a no-op
        // that `receive()` already covers.
        uint256 total = 0;
        for (uint256 i = 0; i < calls.length; ++i) {
            if (calls[i].target == address(this)) revert SelfCallRefused(i);
            total += calls[i].value;
        }
        if (total > ceiling) revert BatchValueExceedsCeiling(total, ceiling);

        for (uint256 i = 0; i < calls.length; ++i) {
            Call calldata c = calls[i];
            bytes4 selector = i == 0 ? firstSelector : _selectorOf(c.data);
            bool allowed = i == 0 ? firstAllowed : registry.isAllowed(pinId, c.target, selector);

            if (!allowed) revert CapabilityNotDeclared(c.target, selector);

            (bool ok, bytes memory ret) = c.target.call{value: c.value}(c.data);
            if (!ok) {
                // Bubble the original revert so callers keep useful errors,
                // falling back to an indexed error for empty reverts.
                if (ret.length > 0) {
                    assembly {
                        revert(add(ret, 0x20), mload(ret))
                    }
                }
                revert CallReverted(i);
            }
        }

        emit SkillExecuted(pinId, attestedSkillHash, msg.sender, calls.length);
    }

    /// @dev Empty calldata is a bare value transfer and maps to selector zero,
    ///      which a pin must declare explicitly. Fail closed: a pin that declares
    ///      only contract calls can never be used to drain via a plain send.
    function _selectorOf(bytes calldata data) private pure returns (bytes4) {
        return data.length >= 4 ? bytes4(data[:4]) : bytes4(0);
    }

    receive() external payable {}
}
