// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "./interfaces/IERC20.sol";

/// @title PinRegistry
/// @notice Publishers pin an exact skill version, declare the on-chain
///         capabilities that version may use, and post a bond priced by how much
///         damage those capabilities could do.
///
/// A pin is immutable once published. Changing a skill's bytes yields a different
/// `skillHash` and therefore a different pin, which is the property the whole
/// system rests on: a silent update cannot inherit an existing approval.
///
/// ## Why bonds are priced by breadth, not by value
///
/// An early design sized bonds against `maxValuePerCall`. That is close to
/// useless, and the reason is worth stating plainly: almost nothing interesting
/// moves native value. A swap skill calls `router.swap(...)` with `value == 0` and
/// moves tokens through an allowance the account granted earlier. A native-value
/// ceiling does not constrain it at all.
///
/// What actually determines blast radius is **which functions the skill may
/// call**. A skill permitted to call `approve` on a token can hand unlimited
/// allowance to an attacker-controlled address, which is categorically worse than
/// one permitted to call `swap` on a known router. So pricing keys on:
///
///   - how many distinct (target, selector) pairs are declared — breadth
///   - how many of those selectors are allowance- or transfer-granting — severity
///   - the native-value ceiling — still counted, just no longer the main term
///
/// This closes the hole where a publisher declares sweeping capabilities, never
/// violates its own manifest, and stays perfectly compliant while draining users.
/// Declaring power now costs money proportional to the power declared.
///
/// ## Division of labour
///
/// This contract bounds *which code may call which functions*. It does not bound
/// amounts, because amount limits belong with the wallet that holds the funds —
/// MetaMask Agent Wallet already does spend limits well. The two compose; neither
/// subsumes the other. Do not add token-amount parsing here.
contract PinRegistry {
    struct Pin {
        address publisher;
        bytes32 skillHash;
        /// keccak256 of the declared name and version, e.g. ("kuru-quote", "1.0.0").
        ///
        /// Committed so equivocation is provable. Without it a publisher can ship
        /// two different byte sets under one version string and the chain has no
        /// way to see the contradiction.
        bytes32 versionId;
        uint256 maxValuePerCall;
        /// Bond locked against this pin at publish time. Immutable thereafter, so
        /// a later change to pricing parameters cannot retroactively under- or
        /// over-collateralise an existing pin.
        uint256 requiredBond;
        uint32 capabilityCount;
        uint32 highRiskCount;
        uint64 publishedAt;
        /// Timestamp of revocation, or zero. Also gates bond reclamation.
        uint64 revokedAt;
        bool exists;
        /// Set when this pin's bond has been taken by a successful challenge.
        bool slashed;
    }

    /// Asset bonds are denominated in. AUSD in production.
    IERC20 public immutable bondAsset;

    /// Flat cost of publishing anything at all.
    uint256 public immutable baseBond;
    /// Cost per declared (target, selector) pair.
    uint256 public immutable perCapabilityBond;
    /// Additional cost per declared pair whose selector can grant or move tokens.
    uint256 public immutable highRiskBond;
    /// Additional cost, charged once, if the pin permits moving native value at all.
    ///
    /// @dev Deliberately a flat charge rather than a fraction of the declared
    ///      ceiling. Bond is denominated in AUSD (6 decimals) and the ceiling in
    ///      native wei (18 decimals); scaling one by the other is dimensionally
    ///      meaningless without a price oracle, and an earlier version that did so
    ///      demanded ~1e19 AUSD units to pin a 10 MON ceiling. Charging a flat
    ///      premium for *having* native-value capability is sound with no oracle,
    ///      and reflects the fact that the dangerous step is being able to move
    ///      native value at all.
    uint256 public immutable nativeValueBond;
    /// Delay between revoking a pin and reclaiming its bond.
    uint64 public immutable unbondingDelay;
    /// Share of a slashed bond paid to the challenger, in basis points.
    uint256 public immutable challengerRewardBps;
    /// Receives the remainder of a slashed bond.
    ///
    /// @dev Not burned. A later insurance pool should receive this, and pointing it
    ///      somewhere real from the start avoids a migration that touches slashing.
    address public immutable slashRecipient;

    /// @dev pinId => pin
    mapping(bytes32 => Pin) private _pins;
    /// @dev pinId => keccak256(target, selector) => allowed
    mapping(bytes32 => mapping(bytes32 => bool)) private _allowed;
    /// @dev publisher => bond deposited
    mapping(address => uint256) public bondBalance;
    /// @dev publisher => bond committed to live pins. Cannot be withdrawn.
    mapping(address => uint256) public lockedBond;
    /// @dev selector => counts as high risk
    mapping(bytes4 => bool) public isHighRiskSelector;
    /// @dev publisher => versionId => number of pins published for that version.
    ///
    /// More than one means the publisher has made conflicting claims about a single
    /// version, which is provable equivocation. Tracked on chain so `reclaimBond`
    /// can refuse to release collateral while a contradiction stands.
    mapping(address => mapping(bytes32 => uint256)) public versionPinCount;
    /// @dev pinId => bond already reclaimed, so it cannot be reclaimed twice
    mapping(bytes32 => bool) public bondReclaimed;

    event BondDeposited(address indexed publisher, uint256 amount, uint256 balance);
    event BondWithdrawn(address indexed publisher, uint256 amount, uint256 balance);
    event BondLocked(bytes32 indexed pinId, address indexed publisher, uint256 amount);
    event BondReclaimed(bytes32 indexed pinId, address indexed publisher, uint256 amount);

    event Published(
        bytes32 indexed pinId,
        address indexed publisher,
        bytes32 indexed skillHash,
        uint256 maxValuePerCall,
        uint256 capabilityCount,
        uint256 highRiskCount,
        uint256 requiredBond
    );

    event CapabilityDeclared(
        bytes32 indexed pinId, address indexed target, bytes4 indexed selector, bool highRisk
    );

    /// @notice A publisher retracted trust in their own release.
    /// @dev One-way, so users can rely on the signal.
    event Revoked(bytes32 indexed pinId, address indexed publisher);

    /// @notice A publisher's bond was taken for signing conflicting version claims.
    event Slashed(
        bytes32 indexed pinId,
        address indexed publisher,
        address indexed challenger,
        uint256 amount,
        uint256 challengerReward
    );

    error AlreadyPublished();
    error AlreadyRevoked();
    error BondTransferFailed();
    error DuplicateCapability(address target, bytes4 selector);
    error EmptyCapabilities();
    error InsufficientUnlockedBond(uint256 required, uint256 available);
    error LengthMismatch();
    error NotPublisher();
    error NothingToReclaim();
    error EquivocationUnresolved(bytes32 versionId);
    error NoEquivocation(bytes32 versionIdA, bytes32 versionIdB);
    error NotSamePublisher(address a, address b);
    error PinAlreadySlashed();
    error PinNotRevoked();
    error PinUnknown();
    error RewardShareTooHigh();
    error SamePin();
    error SameSkillHash(bytes32 skillHash);
    error ZeroSlashRecipient();
    error ZeroVersionId();
    error TooManyCapabilities(uint256 count, uint256 max);
    error UnbondingNotElapsed(uint64 readyAt);
    error ZeroAmount();
    error ZeroSkillHash();
    error ZeroTarget();

    /// @dev A pin is read in full by UIs and iterated at publish time. Cap the
    ///      count so publishing cannot be made to run out of gas, and so a pin
    ///      stays humanly reviewable — a 500-capability pin is not a boundary
    ///      anyone can meaningfully approve.
    uint256 public constant MAX_CAPABILITIES = 64;

    constructor(
        IERC20 bondAsset_,
        uint256 baseBond_,
        uint256 perCapabilityBond_,
        uint256 highRiskBond_,
        uint256 nativeValueBond_,
        uint64 unbondingDelay_,
        uint256 challengerRewardBps_,
        address slashRecipient_,
        bytes4[] memory highRiskSelectors
    ) {
        if (challengerRewardBps_ > 10_000) revert RewardShareTooHigh();
        if (slashRecipient_ == address(0)) revert ZeroSlashRecipient();
        bondAsset = bondAsset_;
        baseBond = baseBond_;
        perCapabilityBond = perCapabilityBond_;
        highRiskBond = highRiskBond_;
        nativeValueBond = nativeValueBond_;
        unbondingDelay = unbondingDelay_;
        challengerRewardBps = challengerRewardBps_;
        slashRecipient = slashRecipient_;
        for (uint256 i = 0; i < highRiskSelectors.length; ++i) {
            isHighRiskSelector[highRiskSelectors[i]] = true;
        }
    }

    // --- identifiers ---

    /// @notice Deterministic pin identifier.
    /// @dev Scoped by publisher so two publishers shipping byte-identical skills
    ///      get distinct pins. Otherwise publisher A could ride on approvals
    ///      earned by publisher B.
    function computePinId(address publisher, bytes32 skillHash) public pure returns (bytes32) {
        return keccak256(abi.encode(publisher, skillHash));
    }

    /// @notice Canonical version identifier for a skill name and version string.
    /// @dev Length-prefixed via `abi.encode` rather than concatenated, so
    ///      ("ab", "c") and ("a", "bc") cannot collide into one version.
    function computeVersionId(string calldata name, string calldata version)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(name, version));
    }

    function capabilityKey(address target, bytes4 selector) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(target, selector));
    }

    // --- bonding ---

    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (!bondAsset.transferFrom(msg.sender, address(this), amount)) revert BondTransferFailed();
        bondBalance[msg.sender] += amount;
        emit BondDeposited(msg.sender, amount, bondBalance[msg.sender]);
    }

    /// @notice Withdraw bond that is not committed to a live pin.
    function withdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 available = unlockedBond(msg.sender);
        if (amount > available) revert InsufficientUnlockedBond(amount, available);

        bondBalance[msg.sender] -= amount;
        if (!bondAsset.transfer(msg.sender, amount)) revert BondTransferFailed();
        emit BondWithdrawn(msg.sender, amount, bondBalance[msg.sender]);
    }

    function unlockedBond(address publisher) public view returns (uint256) {
        uint256 balance = bondBalance[publisher];
        uint256 locked = lockedBond[publisher];
        return balance > locked ? balance - locked : 0;
    }

    /// @notice Bond required for a given declared capability shape.
    /// @dev Public so a publisher can price a manifest before committing capital,
    ///      and so a UI can show why a wide manifest is expensive.
    function quoteBond(uint256 capabilityCount, uint256 highRiskCount, bool movesNativeValue)
        public
        view
        returns (uint256)
    {
        return baseBond + perCapabilityBond * capabilityCount + highRiskBond * highRiskCount
            + (movesNativeValue ? nativeValueBond : 0);
    }

    // --- publishing ---

    /// @notice Publish a pin for an exact skill hash and lock its bond.
    /// @param skillHash Canonical hash from `lockstep-skill-hash/v2`.
    /// @param maxValuePerCall Native-value ceiling applied to every call.
    /// @param targets Allowed call targets, positionally paired with `selectors`.
    /// @param selectors Allowed selectors. `0x00000000` permits empty calldata.
    function publish(
        bytes32 skillHash,
        bytes32 versionId,
        uint256 maxValuePerCall,
        address[] calldata targets,
        bytes4[] calldata selectors
    ) external returns (bytes32 pinId) {
        if (skillHash == bytes32(0)) revert ZeroSkillHash();
        if (versionId == bytes32(0)) revert ZeroVersionId();
        if (targets.length != selectors.length) revert LengthMismatch();
        if (targets.length == 0) revert EmptyCapabilities();
        if (targets.length > MAX_CAPABILITIES) {
            revert TooManyCapabilities(targets.length, MAX_CAPABILITIES);
        }

        pinId = computePinId(msg.sender, skillHash);
        if (_pins[pinId].exists) revert AlreadyPublished();

        uint32 highRiskCount = 0;
        for (uint256 i = 0; i < targets.length; ++i) {
            address target = targets[i];
            bytes4 selector = selectors[i];
            if (target == address(0)) revert ZeroTarget();

            bytes32 key = capabilityKey(target, selector);
            // Duplicates would inflate the priced capability count without
            // widening real capability, letting a publisher pad a manifest to
            // look expensively bonded while declaring one narrow power. Reject.
            if (_allowed[pinId][key]) revert DuplicateCapability(target, selector);
            _allowed[pinId][key] = true;

            bool highRisk = isHighRiskSelector[selector];
            if (highRisk) highRiskCount += 1;
            emit CapabilityDeclared(pinId, target, selector, highRisk);
        }

        uint256 required = quoteBond(targets.length, highRiskCount, maxValuePerCall > 0);
        uint256 available = unlockedBond(msg.sender);
        if (required > available) revert InsufficientUnlockedBond(required, available);

        lockedBond[msg.sender] += required;
        versionPinCount[msg.sender][versionId] += 1;

        _pins[pinId] = Pin({
            publisher: msg.sender,
            skillHash: skillHash,
            versionId: versionId,
            maxValuePerCall: maxValuePerCall,
            requiredBond: required,
            capabilityCount: uint32(targets.length),
            highRiskCount: highRiskCount,
            publishedAt: uint64(block.timestamp),
            revokedAt: 0,
            exists: true,
            slashed: false
        });

        emit BondLocked(pinId, msg.sender, required);
        emit Published(
            pinId, msg.sender, skillHash, maxValuePerCall, targets.length, highRiskCount, required
        );
    }

    /// @notice Mark a published version as compromised.
    function revoke(bytes32 pinId) external {
        Pin storage p = _pins[pinId];
        if (!p.exists) revert PinUnknown();
        if (p.publisher != msg.sender) revert NotPublisher();
        if (p.revokedAt != 0) revert AlreadyRevoked();
        p.revokedAt = uint64(block.timestamp);
        emit Revoked(pinId, msg.sender);
    }

    // --- slashing ---

    /// @notice Slash a publisher that signed two conflicting claims about one version.
    ///
    /// This is the only slashing condition, and the restraint is deliberate.
    ///
    /// A guard refusal is not misbehaviour: the guard refusing a call is the system
    /// working. "The skill did something bad within its declared capabilities" is not
    /// on-chain decidable and would need a court, which is out of scope. What *is*
    /// decidable, from data already on chain, is equivocation: the publisher told
    /// users that a given name and version is bytes A, then told them the same
    /// version is bytes B. Both statements are signed, both are on chain, and they
    /// cannot both be true.
    ///
    /// That is precisely the rug-pull signature. Ship 1.0.0, collect approvals,
    /// then quietly republish 1.0.0 with different bytes hoping the version string
    /// carries the trust. Here it costs the bond instead.
    ///
    /// Permissionless: anyone can submit the proof and collect the reward. There is
    /// no privileged challenger and no committee.
    ///
    /// @param pinIdA one published pin
    /// @param pinIdB another pin from the same publisher, same version, other bytes
    function slashEquivocation(bytes32 pinIdA, bytes32 pinIdB) external returns (uint256 reward) {
        if (pinIdA == pinIdB) revert SamePin();

        Pin storage a = _pins[pinIdA];
        Pin storage b = _pins[pinIdB];
        if (!a.exists) revert PinUnknown();
        if (!b.exists) revert PinUnknown();
        if (a.publisher != b.publisher) revert NotSamePublisher(a.publisher, b.publisher);
        if (a.versionId != b.versionId) revert NoEquivocation(a.versionId, b.versionId);
        // Identical bytes under one version is not a contradiction. It cannot happen
        // via `publish` because the pin id would collide, but check anyway so the
        // proof stands on its own rather than on an invariant elsewhere.
        if (a.skillHash == b.skillHash) revert SameSkillHash(a.skillHash);

        // Take the later pin's bond. The earlier claim is the one users approved
        // against, so the offence is the contradiction introduced afterwards.
        Pin storage guilty = a.publishedAt >= b.publishedAt ? a : b;
        bytes32 guiltyPinId = a.publishedAt >= b.publishedAt ? pinIdA : pinIdB;
        if (guilty.slashed) revert PinAlreadySlashed();
        // Defensive: `reclaimBond` now refuses to release a bond while its version
        // has conflicting claims, so this should be unreachable. Kept because the
        // alternative — releasing already-released collateral — silently corrupts
        // `lockedBond`, which is exactly the bug this pair of checks was added for.
        if (bondReclaimed[guiltyPinId]) revert NothingToReclaim();

        uint256 amount = guilty.requiredBond;
        address publisher = guilty.publisher;

        guilty.slashed = true;
        // Revoke both so neither version can be used or approved while the
        // contradiction stands. Preserve an existing revocation timestamp.
        if (a.revokedAt == 0) a.revokedAt = uint64(block.timestamp);
        if (b.revokedAt == 0) b.revokedAt = uint64(block.timestamp);

        // Release the commitment before paying out, so a publisher whose only
        // pin was slashed is not left with phantom locked bond.
        lockedBond[publisher] -= amount;
        bondBalance[publisher] -= amount;

        reward = (amount * challengerRewardBps) / 10_000;
        uint256 remainder = amount - reward;

        if (reward > 0 && !bondAsset.transfer(msg.sender, reward)) revert BondTransferFailed();
        if (remainder > 0 && !bondAsset.transfer(slashRecipient, remainder)) {
            revert BondTransferFailed();
        }

        emit Slashed(guiltyPinId, publisher, msg.sender, amount, reward);
        emit Revoked(pinIdA, publisher);
        emit Revoked(pinIdB, publisher);
    }

    /// @notice Release a revoked pin's bond once the unbonding delay has elapsed.
    ///
    /// @dev The delay exists so a publisher cannot ship a hostile update, drain
    ///      users, revoke, and pull their bond out in the same block.
    ///
    ///      A delay alone is not sufficient, and an invariant campaign proved it.
    ///      Equivocation is provable from immutable on-chain data *forever*, so a
    ///      publisher could revoke, wait out the delay, reclaim, and only then
    ///      become unslashable — revoke-and-run with extra steps. Worse, the
    ///      subsequent slash released the same locked bond a second time and broke
    ///      the accounting identity outright.
    ///
    ///      So collateral is frozen while a contradiction stands: if a publisher has
    ///      more than one pin for a version, no pin of that version can be
    ///      reclaimed. The freeze is permanent, because the evidence is.
    function reclaimBond(bytes32 pinId) external {
        Pin storage p = _pins[pinId];
        if (!p.exists) revert PinUnknown();
        if (p.publisher != msg.sender) revert NotPublisher();
        if (p.revokedAt == 0) revert PinNotRevoked();
        if (bondReclaimed[pinId]) revert NothingToReclaim();
        // A slashed bond is already gone. Without this a publisher could reclaim a
        // commitment that was paid out to a challenger, driving `lockedBond` below
        // the true committed amount and letting them over-publish.
        if (p.slashed) revert PinAlreadySlashed();
        // Frozen while conflicting claims about this version remain provable.
        if (versionPinCount[msg.sender][p.versionId] > 1) {
            revert EquivocationUnresolved(p.versionId);
        }

        uint64 readyAt = p.revokedAt + unbondingDelay;
        if (block.timestamp < readyAt) revert UnbondingNotElapsed(readyAt);

        bondReclaimed[pinId] = true;
        lockedBond[msg.sender] -= p.requiredBond;
        emit BondReclaimed(pinId, msg.sender, p.requiredBond);
    }

    // --- reads ---

    /// @notice Hot-path capability check. Single SLOAD.
    function isAllowed(bytes32 pinId, address target, bytes4 selector) external view returns (bool) {
        return _allowed[pinId][capabilityKey(target, selector)];
    }

    function getPin(bytes32 pinId) external view returns (Pin memory) {
        return _pins[pinId];
    }

    /// @notice Pinned skill hash, or zero if the pin is unknown or revoked.
    function liveSkillHash(bytes32 pinId) external view returns (bytes32) {
        Pin storage p = _pins[pinId];
        if (!p.exists || p.revokedAt != 0) return bytes32(0);
        return p.skillHash;
    }

    /// @notice Everything the guard needs about a pin and its first call, in one call.
    /// @dev Exists purely for hot-path gas. Fetching these three facts separately
    ///      cost three CALLs plus a full struct decode; folding them cut roughly
    ///      9.5k gas per transaction. Callers that are not gas sensitive should
    ///      prefer `getPin` and `isAllowed`.
    function verify(bytes32 pinId, address target, bytes4 selector)
        external
        view
        returns (bytes32 liveHash, uint256 maxValuePerCall, bool allowed)
    {
        Pin storage p = _pins[pinId];
        if (p.exists && p.revokedAt == 0) {
            liveHash = p.skillHash;
            maxValuePerCall = p.maxValuePerCall;
        }
        allowed = _allowed[pinId][capabilityKey(target, selector)];
    }
}
