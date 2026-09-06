/** ABI fragments the watcher needs. Narrow by design: one write, `slashEquivocation`. */

export const pinRegistryAbi = [
  {
    type: "function",
    name: "slashEquivocation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pinIdA", type: "bytes32" },
      { name: "pinIdB", type: "bytes32" },
    ],
    outputs: [{ name: "reward", type: "uint256" }],
  },
  {
    type: "function",
    name: "challengerRewardBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "bondReclaimed",
    stateMutability: "view",
    inputs: [{ name: "pinId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "versionPinCount",
    stateMutability: "view",
    inputs: [
      { name: "publisher", type: "address" },
      { name: "versionId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
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
  {
    type: "event",
    name: "Published",
    // The watcher's whole job gets easier here. `versionId` is now on the event, so pins can be
    // grouped by version straight from the log instead of by fetching each pin, and `name` and
    // `version` mean an alert can say which release equivocated rather than quoting a digest.
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
] as const;

/**
 * Guard errors, for decoding revert reasons out of failed transactions.
 *
 * This is how blocked attempts are observed. There is no event for them, because a
 * log emitted before a revert is rolled back and never reaches an indexer.
 */
export const guardErrorsAbi = [
  {
    type: "error",
    name: "SkillHashMismatch",
    inputs: [
      { name: "attested", type: "bytes32" },
      { name: "pinned", type: "bytes32" },
    ],
  },
  {
    type: "error",
    name: "CapabilityNotDeclared",
    inputs: [
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
    ],
  },
  { type: "error", name: "PinNotApproved", inputs: [{ name: "pinId", type: "bytes32" }] },
  {
    // Replaced `ValueExceedsCeiling(value, ceiling)`. The old error reported one call's value
    // against the ceiling, which was the check the guard used to make -- and a per-call check
    // over an unbounded batch let an executor move any amount by splitting it. The ceiling is
    // now a budget for the whole batch, so the first argument is the batch total.
    //
    // The selector changed with the name, so a watcher still carrying the old fragment would
    // silently fail to decode exactly the refusals it exists to report.
    type: "error",
    name: "BatchValueExceedsCeiling",
    inputs: [
      { name: "total", type: "uint256" },
      { name: "ceiling", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "TooManyCalls",
    inputs: [
      { name: "count", type: "uint256" },
      { name: "max", type: "uint256" },
    ],
  },
  { type: "error", name: "NotAuthorizedExecutor", inputs: [{ name: "caller", type: "address" }] },
  { type: "error", name: "EmptyBatch", inputs: [] },
  { type: "error", name: "NotSelf", inputs: [] },
] as const;
