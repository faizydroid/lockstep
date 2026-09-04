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
///   - the native value is within the pin's per-call ceiling
///   - the pin is one the account holder explicitly approved
///   - the pin has not been revoked by its publisher
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
    error ValueExceedsCeiling(uint256 value, uint256 ceiling);
    error EmptyBatch();
    error CallReverted(uint256 index);

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
    ///      signed to their own address. Executors deliberately cannot change
    ///      policy - an agent must never be able to widen its own permissions.
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
    /// @param calls Calls to perform, each checked against the pin.
    function execute(bytes32 pinId, bytes32 attestedSkillHash, Call[] calldata calls) external {
        GuardStorage storage s = _s();

        if (msg.sender != address(this) && !s.authorizedExecutor[msg.sender]) {
            revert NotAuthorizedExecutor(msg.sender);
        }
        if (calls.length == 0) revert EmptyBatch();
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

        for (uint256 i = 0; i < calls.length; ++i) {
            Call calldata c = calls[i];
            bytes4 selector = i == 0 ? firstSelector : _selectorOf(c.data);
            bool allowed = i == 0 ? firstAllowed : registry.isAllowed(pinId, c.target, selector);

            if (c.value > ceiling) revert ValueExceedsCeiling(c.value, ceiling);
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
