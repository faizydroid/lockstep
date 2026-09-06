/**
 * Hand-written ABI fragments for the calls the plugin makes.
 *
 * Deliberately narrow rather than generated from artifacts: the plugin should be
 * installable without the contracts repo, and a small explicit surface makes it
 * obvious which on-chain functions the runtime is allowed to touch. Notably it
 * contains no write function other than `execute` — the plugin cannot publish a
 * pin, approve a pin, or move a bond.
 */

export const pinRegistryAbi = [
  {
    type: "function",
    name: "computePinId",
    stateMutability: "pure",
    inputs: [
      { name: "publisher", type: "address" },
      { name: "skillHash", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "liveSkillHash",
    stateMutability: "view",
    inputs: [{ name: "pinId", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
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
        // Every field of the Solidity struct, in declaration order. See the note on the same
        // fragment in cli/src/abi.ts: an incomplete tuple decodes positionally and silently
        // shifts every later field. This copy only escaped the bug because chain.ts reads
        // `publisher`, which is field zero either way.
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
] as const;

export const lockstepGuardAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pinId", type: "bytes32" },
      { name: "attestedSkillHash", type: "bytes32" },
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isPinApproved",
    stateMutability: "view",
    inputs: [{ name: "pinId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isExecutorAuthorized",
    stateMutability: "view",
    inputs: [{ name: "executor", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "PinApproved",
    inputs: [{ name: "pinId", type: "bytes32", indexed: true }],
  },
  {
    type: "event",
    name: "PinUnapproved",
    inputs: [{ name: "pinId", type: "bytes32", indexed: true }],
  },
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
  {
    type: "error",
    name: "PinNotApproved",
    inputs: [{ name: "pinId", type: "bytes32" }],
  },
  {
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
  {
    type: "error",
    name: "NotAuthorizedExecutor",
    inputs: [{ name: "caller", type: "address" }],
  },
] as const;
