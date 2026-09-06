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
    // A single struct rather than six positional arguments, and the two changes inside it are
    // the point of this signature.
    //
    // `versionId` is gone as an input: the registry derives it from `name` and `version`, because
    // accepting it let a publisher republish different bytes under an unrelated id and escape
    // the only slashing condition in the system. And the value ceiling is now per *batch*, not
    // per call, because a per-call limit over an unbounded batch bounded nothing.
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "skillHash", type: "bytes32" },
          { name: "maxValuePerBatch", type: "uint256" },
          { name: "targets", type: "address[]" },
          { name: "selectors", type: "bytes4[]" },
        ],
      },
    ],
    outputs: [{ name: "pinId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "computeVersionId",
    stateMutability: "pure",
    inputs: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    // Lets the CLI refuse a name before spending gas, using the registry's own rule rather
    // than a second copy of it.
    type: "function",
    name: "isValidLabel",
    stateMutability: "pure",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "MAX_LABEL_BYTES",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
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
    // `versionId`, `name` and `version` are new. The chain used to record no human label at
    // all, so a consumer reading this registry could only ever render a pin as a hash, and
    // equivocation -- a claim about a *name and version* -- was illegible to the people it is
    // evidence for.
    //
    // These names are load-bearing beyond the ABI check: viem keys the decoded `args` object
    // by them.
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


