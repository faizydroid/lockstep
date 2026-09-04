/**
 * ABI fragments used by the CLI.
 *
 * Wider than the plugin's, because the CLI legitimately publishes, approves, and
 * inspects bonds. The plugin's narrower surface is intentional and the two should
 * not be merged.
 */

export const pinRegistryAbi = [
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      { name: "skillHash", type: "bytes32" },
      { name: "versionId", type: "bytes32" },
      { name: "maxValuePerCall", type: "uint256" },
      { name: "targets", type: "address[]" },
      { name: "selectors", type: "bytes4[]" },
    ],
    outputs: [{ name: "pinId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "revoke",
    stateMutability: "nonpayable",
    inputs: [{ name: "pinId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "quoteBond",
    stateMutability: "view",
    inputs: [
      { name: "capabilityCount", type: "uint256" },
      { name: "highRiskCount", type: "uint256" },
      { name: "movesNativeValue", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint256" }],
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
    name: "unlockedBond",
    stateMutability: "view",
    inputs: [{ name: "publisher", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "bondBalance",
    stateMutability: "view",
    inputs: [{ name: "publisher", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "lockedBond",
    stateMutability: "view",
    inputs: [{ name: "publisher", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "bondAsset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "isHighRiskSelector",
    stateMutability: "view",
    inputs: [{ name: "selector", type: "bytes4" }],
    outputs: [{ name: "", type: "bool" }],
  },
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
    name: "isAllowed",
    stateMutability: "view",
    inputs: [
      { name: "pinId", type: "bytes32" },
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
    ],
    outputs: [{ name: "", type: "bool" }],
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
        // Every field of the Solidity struct, in declaration order.
        //
        // This tuple previously omitted `versionId` and `slashed`. Nothing errored, which is
        // what made it dangerous: the components are all statically sized, so viem decodes
        // positionally and each field after the second shifted by one word. `exists` ended up
        // reading `revokedAt`, so a live pin decoded as `exists: false`, `loadPin` returned
        // undefined, and `lockstep status` and `lockstep diff` reported "no pin" for pins that
        // were plainly on chain. A partial tuple is only safe when the fields you keep are a
        // prefix of the struct.
        components: [
          { name: "publisher", type: "address" },
          { name: "skillHash", type: "bytes32" },
          { name: "versionId", type: "bytes32" },
          { name: "maxValuePerCall", type: "uint256" },
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
      { name: "maxValuePerCall", type: "uint256", indexed: false },
      { name: "capabilityCount", type: "uint256", indexed: false },
      { name: "highRiskCount", type: "uint256", indexed: false },
      { name: "requiredBond", type: "uint256", indexed: false },
    ],
  },
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
] as const;

export const lockstepGuardAbi = [
  {
    type: "function",
    name: "approvePin",
    stateMutability: "nonpayable",
    inputs: [{ name: "pinId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "unapprovePin",
    stateMutability: "nonpayable",
    inputs: [{ name: "pinId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "authorizeExecutor",
    stateMutability: "nonpayable",
    inputs: [{ name: "executor", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeExecutor",
    stateMutability: "nonpayable",
    inputs: [{ name: "executor", type: "address" }],
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
] as const;


