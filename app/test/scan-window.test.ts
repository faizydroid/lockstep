/**
 * What the dashboard's direct chain reader shows for the live deployment, and whether it says so when it
 * could not look everywhere.
 *
 * Found by auditing the live site. The build was configured with the registry's deploy block as its
 * log-scan start. The registry was deployed at block 61,714,758 but nothing happened until 62,008,806,
 * 294,048 blocks later, and the reader scans a fixed 4,000-block window. So the live pin read as a chain
 * snapshot with no capabilities, no approval and no executions, the badge rule called it green although
 * both of its powers are high risk, and nothing on the page said the history had been cut short.
 *
 * A fake JSON-RPC endpoint stands in for Monad's public one, with its real 100-block `eth_getLogs` cap
 * and the real block numbers of the live deployment. No network.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  toHex,
} from "viem";
import type { Abi, Address, Hex } from "viem";

import { erc20Abi, lockstepGuardAbi, lockstepLensAbi, pinRegistryAbi } from "@/lib/abi";
import { loadSnapshot, scanWindow } from "@/lib/chain";
import type { AppConfig } from "@/lib/chain";

const ROOT = join(import.meta.dirname, "..", "..");

const REGISTRY: Address = "0xF0800974aE84F55508E3e31F72A52E09b19829B0";
const GUARD: Address = "0xee23156D1B7D64aF1b3671290DdcEf6edF734a81";
const ACCOUNT: Address = "0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2";
const LENS: Address = "0xEB0A033CfDD1e8393Ac512de0DEc36d6C9323Ebc";
const ASSET: Address = "0xd80c19a863e4247B08f6152773820b87eE49a35C";
const PUBLISHER: Address = "0xcc71E1f66CA325A9D3dEC74b2AA94CDF870194Dc";
const EXECUTOR: Address = "0x258981915bF60938809277Eace03a2379aE46472";
const PIN: Hex = "0x6520d020348ee7a8a91fcc071d0f62cf83762c47be749e6654c7ca31c0472df4";
const SKILL: Hex = "0x9b68b339278fd5f40079090a0a535d6c687aaacbb36d9ef888a942a12c600b80";

// Read back from Monad testnet: the registry was created at DEPLOYED, its first event (a bond deposit)
// is FIRST_EVENT, and the last event it ever emitted for this account is the execution.
const DEPLOYED = 61_714_758n;
const FIRST_EVENT = 62_008_806n;
const PUBLISHED_AT = 62_008_809n;
const APPROVED_AT = 62_008_822n;
const EXECUTED_AT = 62_009_032n;
const HEAD = 70_479_546n;

// The value the build ships. Parsed from the files below, never restated, so this test fails if they drift.
const configuredStart = (): bigint => {
  const read = (file: string, pattern: RegExp) => {
    const text = readFileSync(join(ROOT, file), "utf8");
    const match = pattern.exec(text);
    if (match === null) throw new Error(`no scan start found in ${file}`);
    return BigInt(match[1]!);
  };
  const ci = read(".github/workflows/ci.yml", /NEXT_PUBLIC_DEPLOY_BLOCK:\s*"(\d+)"/);
  const deploy = read(".github/workflows/deploy-dashboard.yml", /NEXT_PUBLIC_DEPLOY_BLOCK:\s*"(\d+)"/);
  const example = read(".env.example", /^DEPLOY_BLOCK=(\d+)/m);
  expect(deploy, "deploy-dashboard.yml and ci.yml must build the same dashboard").toBe(ci);
  expect(example, ".env.example must record the same value").toBe(ci);
  return ci;
};

const CONFIG = (deployBlock: bigint): AppConfig => ({
  chainId: 10143,
  rpcUrl: "https://rpc.test.invalid",
  registry: REGISTRY,
  account: ACCOUNT,
  deployBlock,
  pinIds: [PIN],
  lens: LENS,
  guard: GUARD,
});

interface FakeLog {
  address: Address;
  blockNumber: bigint;
  topics: Hex[];
  data: Hex;
}

function log(address: Address, abi: Abi, eventName: string, args: Record<string, unknown>, data: Hex, block: bigint): FakeLog {
  return { address, blockNumber: block, topics: encodeEventTopics({ abi, eventName, args } as never) as Hex[], data };
}

const HIGH_RISK = encodeAbiParameters([{ type: "bool" }], [true]);
const LOGS: FakeLog[] = [
  log(REGISTRY, pinRegistryAbi as Abi, "CapabilityDeclared", { pinId: PIN, target: ASSET, selector: "0x095ea7b3" }, HIGH_RISK, PUBLISHED_AT),
  log(REGISTRY, pinRegistryAbi as Abi, "CapabilityDeclared", { pinId: PIN, target: ASSET, selector: "0xa9059cbb" }, HIGH_RISK, PUBLISHED_AT),
  log(ACCOUNT, lockstepGuardAbi as Abi, "PinApproved", { pinId: PIN }, "0x", APPROVED_AT),
  log(ACCOUNT, lockstepGuardAbi as Abi, "SkillExecuted", { pinId: PIN, skillHash: SKILL, executor: EXECUTOR }, encodeAbiParameters([{ type: "uint256" }], [2n]), EXECUTED_AT),
];

const ALL_ABIS = [...pinRegistryAbi, ...lockstepGuardAbi, ...lockstepLensAbi, ...erc20Abi] as Abi;

interface Fake {
  chainId: number;
  /** Monad's public RPC refuses wider log ranges; a local node does not. */
  rangeCap: bigint | undefined;
  methods: string[];
}

function answer(fn: string): unknown {
  switch (fn) {
    case "baseBond": return 100_000_000n;
    case "perCapabilityBond": return 25_000_000n;
    case "highRiskBond": return 500_000_000n;
    case "nativeValueBond": return 0n;
    case "challengerRewardBps": return 5000n;
    case "unbondingDelay": return 600n;
    case "bondAsset": return ASSET;
    case "decimals": return 6;
    case "symbol": return "mAUSD";
    case "getPin":
      return {
        publisher: PUBLISHER, skillHash: SKILL,
        versionId: "0xa471c57035177fce9bb1884e4c409e544da6cb23018818ab21ceca4f1e7955a5",
        maxValuePerBatch: 0n, requiredBond: 1_150_000_000n, capabilityCount: 2, highRiskCount: 2,
        publishedAt: 1_789_249_350n, revokedAt: 0n, exists: true, slashed: false,
      };
    case "guardStorageSlot": return `0x${"ab".repeat(32)}`;
    case "identity": return "0x8004a818bfb912233c491871b3d84c89a494bd9e";
    case "reputation": return "0x8004b663056a597dffe9eccc1965a193b7388713";
    case "MAX_CANDIDATES": return 64n;
    case "eligibleReviewers": return [ACCOUNT];
    default: throw new Error(`unanswered ${fn}`);
  }
}

function installFakeRpc(fake: Fake): void {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const calls = Array.isArray(body) ? body : [body];
    const answers = calls.map((call: { id: number; method: string; params: unknown[] }) => {
      fake.methods.push(call.method);
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: call.id, result });
      switch (call.method) {
        case "eth_chainId": return ok(toHex(fake.chainId));
        case "eth_blockNumber": return ok(toHex(HEAD));
        case "eth_getCode": return ok(`0xef0100${GUARD.slice(2).toLowerCase()}`);
        case "eth_getLogs": {
          const f = call.params[0] as { address: string; fromBlock: Hex; toBlock: Hex | "latest" };
          const from = BigInt(f.fromBlock);
          const to = f.toBlock === "latest" ? HEAD : BigInt(f.toBlock);
          if (fake.rangeCap !== undefined && to - from + 1n > fake.rangeCap) {
            return { jsonrpc: "2.0", id: call.id, error: { code: -32614, message: `eth_getLogs is limited to a ${fake.rangeCap} range` } };
          }
          return ok(
            LOGS.filter((l) => l.address.toLowerCase() === f.address.toLowerCase() && l.blockNumber >= from && l.blockNumber <= to).map((l, i) => ({
              address: l.address,
              topics: l.topics,
              data: l.data,
              blockNumber: toHex(l.blockNumber),
              blockHash: `0x${"11".repeat(32)}`,
              transactionHash: `0x${"22".repeat(32)}`,
              transactionIndex: "0x0",
              logIndex: toHex(i),
              removed: false,
            })),
          );
        }
        case "eth_call": {
          const tx = call.params[0] as { data: Hex };
          const { functionName } = decodeFunctionData({ abi: ALL_ABIS, data: tx.data });
          return ok(encodeFunctionResult({ abi: ALL_ABIS, functionName, result: answer(functionName) } as never));
        }
        default:
          return { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: call.method } };
      }
    });
    return new Response(JSON.stringify(Array.isArray(body) ? answers : answers[0]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("scanWindow", () => {
  it("has no window on a local chain, where one unbounded query is complete", () => {
    expect(scanWindow(0n, 1_000n)).toBeUndefined();
  });

  it("covers a fixed span from the start and reports that it stops short of the head", () => {
    const w = scanWindow(FIRST_EVENT, HEAD)!;
    expect(w.from).toBe(FIRST_EVENT);
    expect(w.to).toBe(FIRST_EVENT + 4_000n);
    expect(w.partial).toBe(true);
  });

  it("is complete when the head is inside the span", () => {
    const w = scanWindow(1_000n, 1_500n)!;
    expect(w).toEqual({ from: 1_000n, to: 1_500n, partial: false });
  });
});

describe("the scan start the dashboard ships with", () => {
  it("is one value in ci.yml, deploy-dashboard.yml and .env.example", () => {
    expect(configuredStart()).toBeGreaterThan(0n);
  });

  it("covers every event the live deployment has emitted, which a start at the deploy block does not", () => {
    const start = configuredStart();
    const end = scanWindow(start, HEAD)!.to;
    for (const block of [FIRST_EVENT, PUBLISHED_AT, APPROVED_AT, EXECUTED_AT]) {
      expect(start <= block && block <= end, `block ${block} is inside ${start}..${end}`).toBe(true);
    }
    // The configuration that was shipped before: it could not reach any of them.
    const old = scanWindow(DEPLOYED - 1n, HEAD)!;
    expect(EXECUTED_AT > old.to).toBe(true);
  });
});

describe("the live deployment, read through Monad's capped RPC", () => {
  it("shows both high-risk capabilities, the approval and the execution from the shipped scan start", async () => {
    const fake: Fake = { chainId: 10143, rangeCap: 100n, methods: [] };
    installFakeRpc(fake);

    const snap = await loadSnapshot(CONFIG(configuredStart()));

    expect(snap.source.kind).toBe("chain");
    const pin = snap.pins[0]!;
    expect(pin.capabilities.map((c) => c.selector).sort()).toEqual(["0x095ea7b3", "0xa9059cbb"]);
    expect(pin.capabilities.every((c) => c.highRisk)).toBe(true);
    expect(snap.approvals).toHaveLength(1);
    expect(snap.executions).toHaveLength(1);
    expect(snap.totals.executions).toBe(1);
  });

  it("says the window is partial, because it does not reach the head", async () => {
    installFakeRpc({ chainId: 10143, rangeCap: 100n, methods: [] });
    const snap = await loadSnapshot(CONFIG(configuredStart()));
    if (snap.source.kind !== "chain") throw new Error("expected a chain read");
    expect(snap.source.window?.partial).toBe(true);
    expect(snap.source.window?.from).toBe(configuredStart());
  });

  it("flags a start that misses the events, instead of presenting an empty registry as complete", async () => {
    installFakeRpc({ chainId: 10143, rangeCap: 100n, methods: [] });
    const snap = await loadSnapshot(CONFIG(DEPLOYED - 1n));
    if (snap.source.kind !== "chain") throw new Error("expected a chain read");
    // The data really is missing: this is the limitation, and it is now disclosed rather than hidden.
    expect(snap.pins[0]!.capabilities).toHaveLength(0);
    expect(snap.approvals).toHaveLength(0);
    expect(snap.source.window?.partial).toBe(true);
  });

  it("reports no window on a local chain, where the read is one complete query", async () => {
    installFakeRpc({ chainId: 10143, rangeCap: undefined, methods: [] });
    const snap = await loadSnapshot(CONFIG(0n));
    if (snap.source.kind !== "chain") throw new Error("expected a chain read");
    expect(snap.source.window).toBeUndefined();
    expect(snap.pins[0]!.capabilities).toHaveLength(2);
  });
});

describe("the endpoint has to be the chain the build says it is", () => {
  it("falls back to sample data, with the reason, when the RPC answers for another chain", async () => {
    const fake: Fake = { chainId: 1, rangeCap: 100n, methods: [] };
    installFakeRpc(fake);

    const snap = await loadSnapshot(CONFIG(configuredStart()));

    expect(fake.methods).toContain("eth_chainId");
    expect(snap.source.kind).toBe("sample");
    expect(snap.source.kind === "sample" ? snap.source.reason : "").toMatch(/chain 1\b.*chain 10143|chain 10143/);
  });
});
