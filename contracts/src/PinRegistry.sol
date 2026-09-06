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
/// An early design sized bonds against the pin's native-value ceiling. That is close to
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
        /// Most native value one guarded batch may move in total.
        ///
        /// This was `maxValuePerCall` and it was enforced per call, with nothing bounding how many
        /// calls a batch could hold. A per-call ceiling over an unbounded batch is not a ceiling:
        /// the guard's own documentation offered "the native value is within the pin's per-call
        /// ceiling" as a trustless guarantee, while a compromised executor could move any amount in
        /// one transaction by splitting it. The number a user read on an approval screen was an
        /// upper bound on nothing they could observe.
        ///
        /// One number, per batch, because that is the only shape a user can reason about. Splitting
        /// this into a per-call limit and a per-batch limit was considered and rejected: two numbers
        /// constrain the *shape* of spending rather than the amount, and blast radius — the thing
        /// this system exists to bound — depends only on the total.
        uint256 maxValuePerBatch;
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

    /// @notice Arguments to `publish`.
    ///
    /// @dev Grouped for a mechanical reason rather than an aesthetic one, and the reason is worth
    ///      recording so nobody flattens it back.
    ///
    ///      The flat six-parameter form kept ten stack slots live for the entire function body —
    ///      two each for `name`, `version`, `targets` and `selectors`, since a calldata string or
    ///      array is an offset plus a length, and one each for `skillHash` and `maxValuePerBatch`.
    ///      That left six slots for everything else, and the legacy code generator then could not
    ///      reach far enough down to assemble the `Published` payload: "stack too deep". A calldata
    ///      struct is a single slot, and each field is loaded from its calldata offset where it is
    ///      used.
    ///
    ///      The alternatives were both worse. `viaIR` dissolves this class of problem but changes
    ///      every gas figure recorded in this repository and multiplies compile time, for a
    ///      one-function limitation. Splitting `Published` into a numeric event plus a label event
    ///      keeps the flat signature, but then no consumer can read one release without joining two
    ///      logs, which is a permanent tax on every indexer to save a one-off change to six
    ///      callers.
    struct PublishParams {
        /// Skill name. Printable ASCII, no spaces, 1 to `MAX_LABEL_BYTES`.
        string name;
        /// Version string. Same rule. Semver by convention, unenforced.
        string version;
        /// Canonical hash from `lockstep-skill-hash/v2`.
        bytes32 skillHash;
        /// Native-value ceiling applied to a whole batch, not to each call in it.
        uint256 maxValuePerBatch;
        /// Allowed call targets, positionally paired with `selectors`.
        address[] targets;
        /// Allowed selectors. `0x00000000` permits empty calldata.
        bytes4[] selectors;
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
    /// @dev publisher => versionId => number of *unresolved* claims about that version.
    ///
    /// Incremented on publish, decremented when a claim is slashed. More than one means the
    /// publisher has made conflicting claims that nobody has yet adjudicated, which is provable
    /// equivocation. Tracked on chain so `reclaimBond` can refuse to release collateral while a
    /// contradiction stands.
    ///
    /// ## Why this counts unresolved claims rather than publishes
    ///
    /// It used to count publishes and never decrement, and that quietly destroyed money.
    ///
    /// Two effects. A publisher whose build is not reproducible — a different compiler, a timestamp
    /// baked into a bundle, a lockfile that resolved differently — publishes `1.0.0` twice with
    /// different bytes by accident, and *both* bonds freeze with no way out. And after a genuine
    /// challenge succeeded, the surviving honest pin stayed frozen too, because the count still read
    /// two. Its bond was then locked forever: not paid to a challenger, not returned, not burned.
    /// Simply stranded, with no beneficiary at all.
    ///
    /// A frozen-with-no-beneficiary bond is strictly worse than a slashed one. Slashing at least
    /// pays someone and deters something. This paid nobody and deterred nothing; it was pure loss
    /// applied to whichever claim happened to be honest.
    ///
    /// Decrementing on slash fixes both. Once a contradiction has been priced, there is nothing left
    /// for the freeze to protect, so the survivor unfreezes — and because `slashEquivocation` is
    /// permissionless, a publisher who equivocated by accident can prove it against themselves,
    /// forfeit the offending bond, and recover the rest. That is the escape hatch, and it costs the
    /// publisher exactly what the mistake was worth.
    ///
    /// Three claims under one version leave two unresolved after one slash, so the freeze correctly
    /// holds until every contradiction has been answered.
    mapping(address => mapping(bytes32 => uint256)) public versionPinCount;
    /// @dev pinId => bond already reclaimed, so it cannot be reclaimed twice
    mapping(bytes32 => bool) public bondReclaimed;

    event BondDeposited(address indexed publisher, uint256 amount, uint256 balance);
    event BondWithdrawn(address indexed publisher, uint256 amount, uint256 balance);
    event BondLocked(bytes32 indexed pinId, address indexed publisher, uint256 amount);
    event BondReclaimed(bytes32 indexed pinId, address indexed publisher, uint256 amount);

    /// @notice A publisher committed to an exact byte set for a named version.
    ///
    /// @dev `name` and `version` are recorded, not just the `versionId` derived from them.
    ///
    ///      Two reasons, and the second is the one that changed the design. An indexer or a UI
    ///      reading this registry previously had no way to render a pin as anything but a hash,
    ///      because the human label lived only in an off-chain manifest. And equivocation is a
    ///      claim about a *name and version* — "they said kuru-quote 1.0.0 was these bytes, then
    ///      said it was those" — which is unreadable if the chain only holds the digest of the
    ///      pair. Recording the preimage makes the offence legible to the people it is evidence
    ///      for, at a cost of roughly a kilogas on a path that runs once per release.
    event Published(
        bytes32 indexed pinId,
        address indexed publisher,
        bytes32 indexed skillHash,
        bytes32 versionId,
        string name,
        string version,
        uint256 maxValuePerBatch,
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
    error TooManyCapabilities(uint256 count, uint256 max);
    error UnbondingNotElapsed(uint64 readyAt);
    error ZeroAmount();
    error ZeroSkillHash();
    error ZeroTarget();
    error LabelEmpty();
    error LabelTooLong(uint256 length, uint256 max);
    error LabelNotPrintableAscii();

    /// @dev A pin is read in full by UIs and iterated at publish time. Cap the
    ///      count so publishing cannot be made to run out of gas, and so a pin
    ///      stays humanly reviewable — a 500-capability pin is not a boundary
    ///      anyone can meaningfully approve.
    uint256 public constant MAX_CAPABILITIES = 64;

    /// @dev Longest accepted skill name or version string, in bytes.
    ///
    ///      Bounds the calldata and the event payload. 64 bytes is longer than any real package
    ///      name and far longer than any semver, and the cap exists so a publisher cannot write a
    ///      novel into an event that indexers must store.
    uint256 public constant MAX_LABEL_BYTES = 64;

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
    ///
    /// @dev Length-prefixed via `abi.encode` rather than concatenated, so ("ab", "c") and
    ///      ("a", "bc") cannot collide into one version.
    ///
    ///      **This is no longer merely a helper.** `publish` derives the version id by calling
    ///      this, and the id can no longer be supplied by the caller. See the note there.
    function computeVersionId(string calldata name, string calldata version)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(name, version));
    }

    /// @notice Whether a label would be accepted by `publish`.
    ///
    /// @dev Exposed so a publisher's tooling can reject a name before spending gas, and so the
    ///      rule is checkable rather than only documented.
    function isValidLabel(string calldata label) public pure returns (bool) {
        bytes calldata raw = bytes(label);
        if (raw.length == 0 || raw.length > MAX_LABEL_BYTES) return false;
        for (uint256 i = 0; i < raw.length; ++i) {
            uint8 c = uint8(raw[i]);
            if (c < 0x21 || c > 0x7e) return false;
        }
        return true;
    }

    /// @dev Reverts unless the label is non-empty, within `MAX_LABEL_BYTES`, and printable ASCII
    ///      with no spaces.
    ///
    ///      The character rule is the load-bearing part and it is deliberately blunt. Deriving the
    ///      version id on chain stops a publisher choosing an arbitrary id, but it does not by
    ///      itself stop them choosing an arbitrary *name*: `"kuru-quote "` with a trailing space,
    ///      or a Cyrillic `о` in place of a Latin `o`, both render as the skill users already
    ///      trust while hashing to an unrelated version id — which reopens the same evasion one
    ///      layer up. Restricting labels to printable ASCII with no whitespace removes the entire
    ///      class in one comparison, at the cost of refusing non-Latin skill names.
    ///
    ///      That cost is real and is accepted rather than hidden: a registry whose identifiers are
    ///      confusable is worse than one whose identifiers are narrow, because the confusable
    ///      version is *silently* broken and the narrow one fails loudly at publish time.
    ///      Normalising instead — case folding, NFKC — is the alternative, and it is not available:
    ///      Unicode normalisation is thousands of gas and a table this contract cannot carry.
    function _requireLabel(string calldata label) private pure {
        bytes calldata raw = bytes(label);
        if (raw.length == 0) revert LabelEmpty();
        if (raw.length > MAX_LABEL_BYTES) revert LabelTooLong(raw.length, MAX_LABEL_BYTES);
        for (uint256 i = 0; i < raw.length; ++i) {
            uint8 c = uint8(raw[i]);
            // 0x21 '!' through 0x7e '~'. Excludes 0x20 space, every control character, and
            // everything above ASCII.
            if (c < 0x21 || c > 0x7e) revert LabelNotPrintableAscii();
        }
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
    ///
    /// ## The version id is derived here, not accepted
    ///
    /// This function used to take `bytes32 versionId` as a parameter and never check it against
    /// anything. `computeVersionId` existed and nothing forced a caller to use it.
    ///
    /// That defeated the only slashing condition in the system, and it did so for free. Publish
    /// 1.0.0 honestly, collect approvals, then republish different bytes under
    /// `versionId = keccak256(<anything>)`. Users still see "1.0.0" because the version string
    /// they read lives in a manifest, not on chain. Two contradictory claims about one release
    /// exist, and `slashEquivocation` cannot see a contradiction because the two pins report
    /// unrelated version ids. The rug pull this registry is built to price became unpriced, and the
    /// bond became decorative. The honest CLI and the Action both derived the id correctly, which
    /// is precisely why nothing caught it: the attack needs one `cast send`.
    ///
    /// So the strings come in and the id goes out. `versionId` is now a function of data the caller
    /// must state in public, and `_requireLabel` bounds what that data can be. An attacker who
    /// wants a different version id has to publish under a visibly different name or version, which
    /// is the whole point — that is a new release, not a silent replacement of an old one.
    ///
    /// @param p See `PublishParams`.
    function publish(PublishParams calldata p) external returns (bytes32 pinId) {
        if (p.skillHash == bytes32(0)) revert ZeroSkillHash();
        _requireLabel(p.name);
        _requireLabel(p.version);
        // Derived, never supplied. A non-empty label pair cannot hash to zero in practice, so the
        // old `ZeroVersionId` check has no remaining input to guard and is gone with the parameter.
        bytes32 versionId = computeVersionId(p.name, p.version);
        if (p.targets.length != p.selectors.length) revert LengthMismatch();
        if (p.targets.length == 0) revert EmptyCapabilities();
        if (p.targets.length > MAX_CAPABILITIES) {
            revert TooManyCapabilities(p.targets.length, MAX_CAPABILITIES);
        }

        pinId = computePinId(msg.sender, p.skillHash);
        if (_pins[pinId].exists) revert AlreadyPublished();

        uint32 highRiskCount = _declareCapabilities(pinId, p.targets, p.selectors);

        uint256 required = quoteBond(p.targets.length, highRiskCount, p.maxValuePerBatch > 0);
        uint256 available = unlockedBond(msg.sender);
        if (required > available) revert InsufficientUnlockedBond(required, available);

        lockedBond[msg.sender] += required;
        versionPinCount[msg.sender][versionId] += 1;

        _pins[pinId] = Pin({
            publisher: msg.sender,
            skillHash: p.skillHash,
            versionId: versionId,
            maxValuePerBatch: p.maxValuePerBatch,
            requiredBond: required,
            capabilityCount: uint32(p.targets.length),
            highRiskCount: highRiskCount,
            publishedAt: uint64(block.timestamp),
            revokedAt: 0,
            exists: true,
            slashed: false
        });

        emit BondLocked(pinId, msg.sender, required);
        emit Published(
            pinId,
            msg.sender,
            p.skillHash,
            versionId,
            p.name,
            p.version,
            p.maxValuePerBatch,
            p.targets.length,
            highRiskCount,
            required
        );
    }

    /// @dev Records the declared capability set and returns how many of them are high risk.
    ///
    ///      Split out of `publish` to keep the loop's locals off `publish`'s frame; the shape is
    ///      otherwise unchanged.
    function _declareCapabilities(
        bytes32 pinId,
        address[] calldata targets,
        bytes4[] calldata selectors
    ) private returns (uint32 highRiskCount) {
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
    /// ## The real penalty is the non-reward share, not the whole bond
    ///
    /// Stated because the arithmetic is easy to get wrong in a publisher's favour and this
    /// contract should not be read as claiming more than it does.
    ///
    /// Challenging is permissionless, so the offender is also a potential challenger. Nothing
    /// stops them submitting the proof themselves from an unrelated address and collecting
    /// `challengerRewardBps` of their own forfeited bond. At the configured 5,000 bps that
    /// halves the cost of equivocating: the effective penalty is the `slashRecipient` share,
    /// not the full bond.
    ///
    /// This is not fixable by checking `msg.sender != publisher`. A fresh EOA defeats that in
    /// one transaction, and a check which looks like a protection but is not is worse than no
    /// check — it invites people to price the risk wrong. The alternatives are all worse:
    /// a privileged challenger set reintroduces a committee, and dropping the reward removes
    /// the only funding a watcher has.
    ///
    /// So the honest figure is: equivocation costs a publisher
    /// `requiredBond * (10_000 - challengerRewardBps) / 10_000`, and the reward exists to make
    /// sure *somebody* is watching, not to make the offence maximally expensive. The same
    /// permissionlessness is what gives an honest publisher a way out of an accidental
    /// contradiction — see `reclaimBond`.
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
        // This contradiction is now answered, so it no longer freezes collateral. Without this
        // decrement the surviving honest pin's bond stayed locked forever with no beneficiary — see
        // the note on `versionPinCount`. Cannot underflow: a pin is slashed at most once, so
        // decrements can never outnumber the publishes that incremented it.
        versionPinCount[guilty.publisher][guilty.versionId] -= 1;
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
    ///      So collateral is frozen while a contradiction stands: if a publisher has more than one
    ///      unresolved claim for a version, no pin of that version can be reclaimed.
    ///
    ///      ## The freeze lifts on adjudication, not on time
    ///
    ///      It used to be permanent, on the reasoning that the evidence is permanent. That was
    ///      wrong, and the way it was wrong is worth keeping written down.
    ///
    ///      Permanent meant two things nobody intended. An honest publisher with a
    ///      non-reproducible build could equivocate by accident and lose both bonds with no path
    ///      out. And after a challenge succeeded, the *surviving* pin — the honest, earlier claim
    ///      users had actually approved against — stayed frozen too, so its collateral was
    ///      confiscated and handed to nobody.
    ///
    ///      The evidence being permanent argues for freezing until the contradiction is
    ///      **answered**, not forever. Once a claim has been slashed, the bond behind it has been
    ///      paid out and there is nothing further a challenger could take; continuing to hold the
    ///      survivor's collateral protects no one.
    ///
    ///      A publisher stuck here is not stuck: `slashEquivocation` takes no permissions, so they
    ///      can prove their own contradiction, forfeit the later claim's bond, and reclaim the rest.
    ///      Deliberately not a separate "withdraw my mistake" entry point — that would be a second
    ///      code path to the same state transition, reachable only by the party with the most
    ///      incentive to find an edge in it.
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
        // Frozen while unanswered conflicting claims about this version remain provable.
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
        returns (bytes32 liveHash, uint256 maxValuePerBatch, bool allowed)
    {
        Pin storage p = _pins[pinId];
        if (p.exists && p.revokedAt == 0) {
            liveHash = p.skillHash;
            maxValuePerBatch = p.maxValuePerBatch;
        }
        allowed = _allowed[pinId][capabilityKey(target, selector)];
    }
}
