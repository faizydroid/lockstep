/**
 * The read surface this app uses, and only that.
 *
 * A fourth hand-written ABI in the repo needs justifying. The existing three between them
 * omit most of what a dashboard needs -- the bond-pricing immutables, `Revoked`, the four bond
 * events, the executor events, the guard's approval views -- so reusing one would mean
 * widening a package's ABI for a consumer it does not serve. Writing them once here, for
 * reads only, keeps each package's ABI matched to its own job.
 *
 * Drift is not a risk left to discipline: e2e/test/abi.test.ts compares every fragment below
 * against the compiled Foundry artifact, and it exists because two packages once declared the
 * `Pin` struct with nine fields where Solidity has eleven. Nothing threw. Every component is
 * statically sized, so viem decoded positionally, `exists` read `revokedAt`, and live pins
 * came back as `exists: false`.
 *
 * Tuple component names are load-bearing: they become keys on the object viem returns.
 */

export const pinRegistryAbi = [
  // --- bond pricing, all immutable after deploy ---
  { type: "function", name: "bondAsset", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "baseBond", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "perCapabilityBond", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "highRiskBond", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "nativeValueBond", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "unbondingDelay", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "challengerRewardBps", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "slashRecipient", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "MAX_CAPABILITIES", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },

  // --- per-publisher bond state ---
  { type: "function", name: "bondBalance", stateMutability: "view", inputs: [{ name: "publisher", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "lockedBond", stateMutability: "view", inputs: [{ name: "publisher", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "unlockedBond", stateMutability: "view", inputs: [{ name: "publisher", type: "address" }], outputs: [{ name: "", type: "uint256" }] },

  // --- pins ---
  {
    type: "function",
    name: "getPin",
    stateMutability: "view",
    inputs: [{ name: "pinId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "publisher", type: "address" },
          { name: "skillHash", type: "bytes32" },
          { name: "versionId", type: "bytes32" },
          { name: "maxValuePerBatch", type: "uint256" },
          { name: "requiredBond", type: "uint256" },
          { name: "capabilityCount", type: "uint32" },
          { name: "highRiskCount", type: "uint32" },
          { name: "publishedAt", type: "uint64" },
          { name: "revokedAt", type: "uint64" },
          { name: "exists", type: "bool" },
          { name: "slashed", type: "bool" },
        ],
      },
    ],
  },
  { type: "function", name: "liveSkillHash", stateMutability: "view", inputs: [{ name: "pinId", type: "bytes32" }], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "isAllowed", stateMutability: "view", inputs: [{ name: "pinId", type: "bytes32" }, { name: "target", type: "address" }, { name: "selector", type: "bytes4" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "bondReclaimed", stateMutability: "view", inputs: [{ name: "pinId", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "isHighRiskSelector", stateMutability: "view", inputs: [{ name: "selector", type: "bytes4" }], outputs: [{ name: "", type: "bool" }] },
  /**
   * More than one live pin for a publisher and version is provable equivocation.
   *
   * Worth reading directly, because the indexer's model has no `versionId` at all and so
   * cannot show a contradiction that nobody has slashed yet.
   */
  { type: "function", name: "versionPinCount", stateMutability: "view", inputs: [{ name: "publisher", type: "address" }, { name: "versionId", type: "bytes32" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "quoteBond", stateMutability: "view", inputs: [{ name: "capabilityCount", type: "uint256" }, { name: "highRiskCount", type: "uint256" }, { name: "movesNativeValue", type: "bool" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "computePinId", stateMutability: "pure", inputs: [{ name: "publisher", type: "address" }, { name: "skillHash", type: "bytes32" }], outputs: [{ name: "", type: "bytes32" }] },

  /*
   * The one registry write this bundle can encode.
   *
   * Permissionless and evidence-based: it names two pins already on chain and the registry checks for
   * itself that both are live and share a version id. The page is never trusted, which is exactly why
   * it is safe here -- and it is the function that most needs a UI, since half the slashed bond goes to
   * whoever challenges and "permissionless" means nothing without somewhere to click.
   *
   * `publish` is absent for the same reason `approvePin` is: it commits a skill hash, and only the
   * machine that hashed the tree can make that claim honestly.
   */
  { type: "function", name: "slashEquivocation", stateMutability: "nonpayable", inputs: [{ name: "pinIdA", type: "bytes32" }, { name: "pinIdB", type: "bytes32" }], outputs: [{ name: "", type: "uint256" }] },

  // --- events ---
  {
    type: "event",
    name: "Published",
    inputs: [
      { name: "pinId", type: "bytes32", indexed: true },
      { name: "publisher", type: "address", indexed: true },
      { name: "skillHash", type: "bytes32", indexed: true },
      { name: "versionId", type: "bytes32", indexed: false },
      { name: "name", type: "string", indexed: false },
      { name: "version", type: "string", indexed: false },
      { name: "maxValuePerBatch", type: "uint256", indexed: false },
      { name: "capabilityCount", type: "uint256", indexed: false },
      { name: "highRiskCount", type: "uint256", indexed: false },
      { name: "requiredBond", type: "uint256", indexed: false },
    ],
  },
  /**
   * The only way to enumerate a pin's capabilities.
   *
   * The registry stores them in a nested mapping that cannot be iterated on chain -- a
   * deliberate trade for the single-SLOAD check the guard makes on every call.
   */
  {
    type: "event",
    name: "CapabilityDeclared",
    inputs: [
      { name: "pinId", type: "bytes32", indexed: true },
      { name: "target", type: "address", indexed: true },
      { name: "selector", type: "bytes4", indexed: true },
      { name: "highRisk", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Revoked",
    inputs: [
      { name: "pinId", type: "bytes32", indexed: true },
      { name: "publisher", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Slashed",
    inputs: [
      { name: "pinId", type: "bytes32", indexed: true },
      { name: "publisher", type: "address", indexed: true },
      { name: "challenger", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "challengerReward", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BondDeposited",
    inputs: [
      { name: "publisher", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "balance", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BondWithdrawn",
    inputs: [
      { name: "publisher", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "balance", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BondLocked",
    inputs: [
      { name: "pinId", type: "bytes32", indexed: true },
      { name: "publisher", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BondReclaimed",
    inputs: [
      { name: "pinId", type: "bytes32", indexed: true },
      { name: "publisher", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * The guard, which runs at each delegated account's own address under EIP-7702.
 *
 * Note what the events do not carry: the account. Under 7702 the code executes at the
 * account, so the account is the log's own address. Reads therefore address the account, not
 * a shared contract.
 */
export const lockstepGuardAbi = [
  { type: "function", name: "isPinApproved", stateMutability: "view", inputs: [{ name: "pinId", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "isExecutorAuthorized", stateMutability: "view", inputs: [{ name: "executor", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "guardStorageSlot", stateMutability: "pure", inputs: [], outputs: [{ name: "", type: "bytes32" }] },

  /*
   * The only two state-changing guard functions this bundle can encode.
   *
   * Both are narrowing: they remove permission and can never grant it. `approvePin`, `authorizeExecutor`
   * and `execute` are deliberately absent. viem builds calldata from a fragment, so withholding the
   * fragment makes those calls unrepresentable in the client rather than merely discouraged -- there is
   * no code path that could send one even by mistake. See lib/policy.ts for the rule and
   * test/policy.test.ts for the enforcement.
   */
  { type: "function", name: "unapprovePin", stateMutability: "nonpayable", inputs: [{ name: "pinId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "revokeExecutor", stateMutability: "nonpayable", inputs: [{ name: "executor", type: "address" }], outputs: [] },

  { type: "event", name: "PinApproved", inputs: [{ name: "pinId", type: "bytes32", indexed: true }] },
  { type: "event", name: "PinUnapproved", inputs: [{ name: "pinId", type: "bytes32", indexed: true }] },
  { type: "event", name: "ExecutorAuthorized", inputs: [{ name: "executor", type: "address", indexed: true }] },
  { type: "event", name: "ExecutorRevoked", inputs: [{ name: "executor", type: "address", indexed: true }] },
  {
    type: "event",
    name: "SkillExecuted",
    inputs: [
      { name: "pinId", type: "bytes32", indexed: true },
      { name: "skillHash", type: "bytes32", indexed: true },
      { name: "executor", type: "address", indexed: true },
      { name: "callCount", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * Guard revert reasons.
 *
 * How a refusal is read at all. There is no blocked-attempt event by design: a log emitted
 * before a revert is rolled back and never reaches an indexer, and an earlier version that
 * emitted one made a refusal cost more gas than a success while still telling nobody. So a
 * refused call is recovered by decoding the revert data of the failed transaction.
 */
export const guardErrorsAbi = [
  { type: "error", name: "SkillHashMismatch", inputs: [{ name: "attested", type: "bytes32" }, { name: "pinned", type: "bytes32" }] },
  { type: "error", name: "CapabilityNotDeclared", inputs: [{ name: "target", type: "address" }, { name: "selector", type: "bytes4" }] },
  { type: "error", name: "PinNotApproved", inputs: [{ name: "pinId", type: "bytes32" }] },
  // Renamed from `ValueExceedsCeiling(value, ceiling)` when the guard's ceiling became a budget
  // for the whole batch instead of a limit on each call. The selector changed with the name, so a
  // stale fragment would silently stop decoding the refusals this list exists to render.
  { type: "error", name: "BatchValueExceedsCeiling", inputs: [{ name: "total", type: "uint256" }, { name: "ceiling", type: "uint256" }] },
  { type: "error", name: "TooManyCalls", inputs: [{ name: "count", type: "uint256" }, { name: "max", type: "uint256" }] },
  { type: "error", name: "NotAuthorizedExecutor", inputs: [{ name: "caller", type: "address" }] },
  { type: "error", name: "EmptyBatch", inputs: [] },
  { type: "error", name: "NotSelf", inputs: [] },
] as const;

/**
 * `LockstepLens`, the ERC-8004 reader. Views only, because that is all it has.
 *
 * Every fragment here is `view`, which is why this ABI needs no entry in lib/policy.ts: the
 * write boundary governs what the browser may *sign*, and there is nothing here to sign. If a
 * write is ever added to the contract, `WRITE_RULES` and `CONTRACTS` in the policy tests have
 * to grow with it, and the `LensView` union in lib/chain.ts turns that omission into a compile
 * error rather than a silent gap.
 *
 * `MAX_CANDIDATES` is a Solidity `constant` and compiles to `view`, not `pure` -- worth stating
 * because the artifact comparison in e2e/test/abi.test.ts checks `stateMutability` exactly.
 */
export const lockstepLensAbi = [
  // --- what it reads, read from the contract rather than trusted from config ---
  { type: "function", name: "pins", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "identity", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "reputation", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "MAX_CANDIDATES", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },

  // --- the Sybil filter ---
  { type: "function", name: "isEligibleReviewer", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "pinIds", type: "bytes32[]" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "eligibleReviewers", stateMutability: "view", inputs: [{ name: "candidates", type: "address[]" }, { name: "pinIds", type: "bytes32[]" }], outputs: [{ name: "eligible", type: "address[]" }] },

  /*
   * The two scores, which only mean something side by side.
   *
   * `unfilteredScore` is the number a Sybil attacker moves at will and the contract says never to
   * use it as a trust signal. It is here precisely so the interface can show it next to the
   * filtered one, since the gap between them is the argument for the filter.
   *
   * Both return a signed `int128` with a separate decimals scale, so neither can be formatted by
   * the unsigned helpers in lib/bond.ts.
   */
  { type: "function", name: "unfilteredScore", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }, { name: "tag1", type: "string" }, { name: "tag2", type: "string" }], outputs: [{ name: "count", type: "uint64" }, { name: "summaryValue", type: "int128" }, { name: "summaryValueDecimals", type: "uint8" }] },
  {
    type: "function",
    name: "weightedScore",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "candidates", type: "address[]" },
      { name: "pinIds", type: "bytes32[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
      { name: "reviewers", type: "address[]" },
    ],
  },
  { type: "function", name: "publisherOf", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },

  /*
   * Reverts the UI has to tell apart from a transport failure.
   *
   * `NoEligibleClients` is the interesting one. It is not an error in the usual sense: it means the
   * filter emptied the client set, which is the correct answer when nobody with a stake has left
   * feedback. Rendering it as a failure would hide the finding, and rendering it as a zero would
   * invent one.
   */
  { type: "error", name: "TooManyCandidates", inputs: [{ name: "count", type: "uint256" }, { name: "max", type: "uint256" }] },
  { type: "error", name: "NoEligibleClients", inputs: [] },
  { type: "error", name: "EmptyPinSet", inputs: [] },
] as const;

/** Minimal ERC-20 surface, for reading the bond asset's decimals and symbol. */
export const erc20Abi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
] as const;
