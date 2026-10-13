/**
 * The Watcher against a real chain, behind a proxy that behaves like Monad's public RPC.
 *
 * Before, `loadPins` asked for `Published` logs from `"earliest"` in one call, which that endpoint refuses,
 * so the watcher could not run on the chain it exists for; `run()` named the pins to `slashEquivocation` in
 * an order that slashed the honest earlier pin when both landed with the same timestamp; and
 * `blockedAttempts` replayed a failed transaction without its sender, so every refusal read as
 * `NotAuthorizedExecutor` and a block it could not read was skipped without a word.
 *
 * Anvil as chain 10143 on port 8559, the proxy on 8561. The proxy forwards everything, counts requests, and
 * answers an `eth_getLogs` over more than 100 blocks with HTTP 413 and code -32614, as Monad does.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  toBytes,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

import { Watcher } from "../src/index.ts";

const ROOT = resolve(__dirname, "../..");
const ANVIL = join(ROOT, ".tools", "foundry", process.platform === "win32" ? "anvil.exe" : "anvil");
const CHAIN_PORT = 8559;
const PROXY_PORT = 8561;
const CHAIN_RPC = `http://127.0.0.1:${CHAIN_PORT}`;
const RPC = `http://127.0.0.1:${PROXY_PORT}`;
const ONE = 1_000_000n;

const KEYS = {
  publisher: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  challenger: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  account: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  executor: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const;
const publisher = privateKeyToAccount(KEYS.publisher);
const challenger = privateKeyToAccount(KEYS.challenger);
const accountSigner = privateKeyToAccount(KEYS.account);
const executor = privateKeyToAccount(KEYS.executor);

const chain = { ...monadTestnet, rpcUrls: { default: { http: [CHAIN_RPC] } } };
const client = createPublicClient({ chain, transport: http(CHAIN_RPC) });
const wallet = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(CHAIN_RPC) });

const TARGET: Address = "0x1111111111111111111111111111111111111111";
const SWAP = toFunctionSelector("swap(uint256)");

const guardExecuteAbi = [
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
  { type: "function", name: "approvePin", stateMutability: "nonpayable", inputs: [{ name: "pinId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "authorizeExecutor", stateMutability: "nonpayable", inputs: [{ name: "executor", type: "address" }], outputs: [] },
] as const;

const available = existsSync(ANVIL);

let anvil: ChildProcess;
let proxy: Server;
let registry: Address;
let guard: Address;
let registryAbi: never;
let deployBlock = 0n;
let refusedRanges = 0;
let logRequests = 0;
let widest = 0n;
let counter = 0;

const fresh = (): Hex => keccak256(toBytes(`skill-${(counter += 1)}-${Math.random()}`));

async function artifact(path: string) {
  return JSON.parse(await readFile(join(ROOT, "contracts", "out", path), "utf8"));
}

async function mined(hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("a setup transaction reverted");
  return receipt;
}

async function publish(name: string, version: string, skillHash: Hex, gas?: bigint): Promise<Hex> {
  const hash = await wallet(KEYS.publisher).writeContract({
    address: registry,
    abi: registryAbi,
    functionName: "publish",
    args: [{ name, version, skillHash, maxValuePerBatch: 0n, targets: [TARGET], selectors: [SWAP] }],
    // With automine off there is no pending state to estimate against, so the caller can fix the limit.
    ...(gas === undefined ? {} : { gas }),
  } as never);
  return hash;
}

async function pinIdOf(skillHash: Hex): Promise<Hex> {
  return (await client.readContract({
    address: registry, abi: registryAbi, functionName: "computePinId", args: [publisher.address, skillHash],
  } as never)) as Hex;
}

async function pinOf(pinId: Hex) {
  return (await client.readContract({ address: registry, abi: registryAbi, functionName: "getPin", args: [pinId] } as never)) as {
    slashed: boolean;
    revokedAt: bigint;
    publishedAt: bigint;
  };
}

/** viem caches getBlockNumber for four seconds, which is longer than these tests take to mine a block. */
const headNow = () => client.getBlockNumber({ cacheTime: 0 });

const rpc = (method: string, params: unknown[] = []) => client.request({ method, params } as never);

function watcherConfig(extra: Record<string, unknown> = {}) {
  return { rpcUrl: RPC, chainId: 10143 as const, registry, fromBlock: deployBlock, ...extra };
}

beforeAll(async () => {
  if (!available) return;
  anvil = spawn(ANVIL, ["--port", String(CHAIN_PORT), "--chain-id", "10143", "--silent"], { stdio: "ignore" });
  const deadline = Date.now() + 100_000;
  for (;;) {
    try {
      await headNow();
      break;
    } catch {
      if (Date.now() > deadline) throw new Error("anvil did not start");
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  proxy = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      try {
        const parsed = JSON.parse(body) as { method?: string; id?: unknown; params?: [{ fromBlock?: string; toBlock?: string }] };
        if (parsed.method === "eth_getLogs") {
          logRequests += 1;
          const filter = parsed.params?.[0] ?? {};
          const from = filter.fromBlock !== undefined && filter.fromBlock.startsWith("0x") ? BigInt(filter.fromBlock) : 0n;
          const to = filter.toBlock !== undefined && filter.toBlock.startsWith("0x") ? BigInt(filter.toBlock) : 10n ** 9n;
          const span = to - from + 1n;
          if (span > widest) widest = span;
          // Monad: more than 100 blocks is refused. `fromBlock: earliest` and `toBlock: latest` are not numbers, so
          // they count as unbounded.
          if (span > 100n || filter.fromBlock === "earliest" || filter.toBlock === "latest" || filter.toBlock === undefined) {
            refusedRanges += 1;
            res.writeHead(413, { "content-type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id ?? 1, error: { code: -32614, message: "eth_getLogs is limited to a 100 range" } }));
            return;
          }
        }
      } catch {
        /* forwarded as-is */
      }
      const upstream = httpRequest(
        { host: "127.0.0.1", port: CHAIN_PORT, method: "POST", headers: { "content-type": "application/json" } },
        (u) => {
          res.writeHead(u.statusCode ?? 200, { "content-type": "application/json" });
          u.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      upstream.end(body);
    });
  });
  await new Promise<void>((r) => proxy.listen(PROXY_PORT, "127.0.0.1", r));

  const bond = await artifact("Deploy.s.sol/MockBondAsset.json");
  const reg = await artifact("PinRegistry.sol/PinRegistry.json");
  const guardArtifact = await artifact("LockstepGuard.sol/LockstepGuard.json");
  registryAbi = reg.abi as never;
  const deploy = async (a: { abi: never; bytecode: { object: Hex } }, args: unknown[]) =>
    mined(await wallet(KEYS.publisher).deployContract({ abi: a.abi, bytecode: a.bytecode.object, args } as never));
  const token = (await deploy(bond, [])).contractAddress as Address;
  const regReceipt = await deploy(reg, [
    token, 100n * ONE, 25n * ONE, 500n * ONE, 500n * ONE, 604800n, 5000n, publisher.address,
    [toFunctionSelector("approve(address,uint256)"), toFunctionSelector("transfer(address,uint256)")],
  ]);
  registry = getAddress(regReceipt.contractAddress as Address);
  deployBlock = regReceipt.blockNumber;
  guard = getAddress((await deploy(guardArtifact, [registry])).contractAddress as Address);

  await mined(await wallet(KEYS.publisher).writeContract({ address: token, abi: bond.abi, functionName: "mint", args: [publisher.address, 100_000n * ONE] } as never));
  await mined(await wallet(KEYS.publisher).writeContract({ address: token, abi: bond.abi, functionName: "approve", args: [registry, 100_000n * ONE] } as never));
  await mined(await wallet(KEYS.publisher).writeContract({ address: registry, abi: registryAbi, functionName: "deposit", args: [100_000n * ONE] } as never));

  for (const who of [challenger, accountSigner, executor]) {
    await mined(await wallet(KEYS.publisher).sendTransaction({ to: who.address, value: 10n ** 18n }));
  }
}, 240_000);

afterAll(async () => {
  anvil?.kill();
  await new Promise<void>((r) => (proxy ? proxy.close(() => r()) : r()));
});

describe.skipIf(!available)("scanning on an RPC that refuses wide log queries", () => {
  it("finds pins published hundreds of blocks apart, without ever sending an over-wide query", async () => {
    const a = fresh();
    const b = fresh();
    await mined(await publish("spread-a", "1.0.0", a));
    await rpc("anvil_mine", ["0x15e"]); // 350 blocks
    await mined(await publish("spread-b", "1.0.0", b));
    refusedRanges = 0;
    logRequests = 0;
    widest = 0n;

    const watcher = new Watcher(watcherConfig());
    const load = await watcher.loadPins();

    const ids = load.pins.map((p) => p.pinId);
    expect(ids).toContain((await pinIdOf(a)).toLowerCase());
    expect(ids).toContain((await pinIdOf(b)).toLowerCase());
    expect(load.truncated).toBe(false);
    expect(refusedRanges, "no query may be wider than the RPC allows").toBe(0);
    expect(widest).toBeLessThanOrEqual(100n);
    expect(logRequests, "350+ blocks at 100 per query is several queries").toBeGreaterThanOrEqual(4);
  }, 120_000);

  it("stops at its request budget, says so, and resumes from where it stopped", async () => {
    const watcher = new Watcher(watcherConfig({ maxLogRequests: 2 }));
    const first = await watcher.loadPins();
    expect(first.truncated).toBe(true);
    expect(watcher.lastScan?.truncated).toBe(true);
    const head = await headNow();
    expect(first.scannedTo).toBeLessThan(head);

    let last = first;
    for (let round = 0; round < 20 && last.truncated; round += 1) last = await watcher.loadPins();

    expect(last.truncated).toBe(false);
    expect(last.pins.length).toBeGreaterThanOrEqual(2);
    expect(last.scannedTo).toBeGreaterThanOrEqual(first.scannedTo);
  }, 120_000);

  it("narrows its window when the RPC allows fewer blocks than it assumed", async () => {
    refusedRanges = 0;
    const watcher = new Watcher(watcherConfig({ logWindow: 400n }));
    const load = await watcher.loadPins();
    expect(refusedRanges, "the 400-block queries were refused, and the watcher recovered").toBeGreaterThan(0);
    expect(load.truncated).toBe(false);
    expect(load.pins.length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("reads pins it was told about without any log query", async () => {
    const skillHash = fresh();
    await mined(await publish("known-only", "1.0.0", skillHash));
    const head = await headNow();
    logRequests = 0;

    const watcher = new Watcher(watcherConfig({ fromBlock: head + 1n, knownPinIds: [await pinIdOf(skillHash)] }));
    const load = await watcher.loadPins();

    expect(load.pins.map((p) => p.pinId)).toContain((await pinIdOf(skillHash)).toLowerCase());
    expect(logRequests).toBe(0);
  }, 60_000);
});

describe.skipIf(!available)("slashing names the guilty pin, not the honest earlier one", () => {
  async function equivocate(name: string, sameBlock: boolean) {
    const honest = fresh();
    const guilty = fresh();
    if (sameBlock) {
      // Both publishes in one block: one timestamp, which is what Monad's 400 ms blocks make common.
      await rpc("evm_setAutomine", [false]);
      try {
        const h1 = await publish(name, "1.0.0", honest, 2_000_000n);
        const h2 = await publish(name, "1.0.0", guilty, 2_000_000n);
        await rpc("evm_mine", []);
        await mined(h1);
        await mined(h2);
      } finally {
        await rpc("evm_setAutomine", [true]);
      }
    } else {
      await mined(await publish(name, "1.0.0", honest));
      await rpc("evm_increaseTime", [30]);
      await mined(await publish(name, "1.0.0", guilty));
    }
    return { honestPin: await pinIdOf(honest), guiltyPin: await pinIdOf(guilty) };
  }

  it("when both claims share a timestamp, the second is slashed and the first is not", async () => {
    const { honestPin, guiltyPin } = await equivocate("tie", true);
    const a = await pinOf(honestPin);
    const b = await pinOf(guiltyPin);
    expect(a.publishedAt, "the premise: one timestamp").toBe(b.publishedAt);

    const watcher = new Watcher(watcherConfig({ challengerPrivateKey: KEYS.challenger }));
    const result = await watcher.run();
    await Promise.all(result.submitted.map((hash) => mined(hash)));

    expect(result.submitted.length).toBeGreaterThanOrEqual(1);
    expect((await pinOf(guiltyPin)).slashed, "the later claim is the offence").toBe(true);
    expect((await pinOf(honestPin)).slashed, "the earlier claim is what users approved against").toBe(false);
  }, 180_000);

  it("when the later claim is strictly later, it is still the one slashed", async () => {
    const { honestPin, guiltyPin } = await equivocate("ordered", false);
    expect((await pinOf(guiltyPin)).publishedAt).toBeGreaterThan((await pinOf(honestPin)).publishedAt);

    const watcher = new Watcher(watcherConfig({ challengerPrivateKey: KEYS.challenger }));
    const result = await watcher.run();
    await Promise.all(result.submitted.map((hash) => mined(hash)));

    expect((await pinOf(guiltyPin)).slashed).toBe(true);
    expect((await pinOf(honestPin)).slashed).toBe(false);
  }, 180_000);

  it("reports that a run was truncated when its log budget ran out", async () => {
    const watcher = new Watcher(watcherConfig({ challengerPrivateKey: KEYS.challenger, maxLogRequests: 1 }));
    const result = await watcher.run();
    expect(result.truncated).toBe(true);
  }, 60_000);
});

describe.skipIf(!available)("blocked attempts", () => {
  it("names the guard's real refusal, and lists the blocks it could not read", async () => {
    // A delegated account that has approved one pin and authorised one executor.
    const skillHash = fresh();
    await mined(await publish("guarded", "1.0.0", skillHash));
    const pinId = await pinIdOf(skillHash);

    const authorization = await wallet(KEYS.account).signAuthorization({ account: accountSigner, contractAddress: guard, executor: "self" });
    await mined(
      await wallet(KEYS.account).sendTransaction({
        account: accountSigner,
        to: accountSigner.address,
        data: encodeFunctionData({ abi: guardExecuteAbi, functionName: "approvePin", args: [pinId] }),
        authorizationList: [authorization],
      }),
    );
    await mined(
      await wallet(KEYS.account).sendTransaction({
        account: accountSigner,
        to: accountSigner.address,
        data: encodeFunctionData({ abi: guardExecuteAbi, functionName: "authorizeExecutor", args: [executor.address] }),
      }),
    );

    // The executor attests to bytes the pin does not hold. A fixed gas limit lets the reverting transaction be mined.
    const attested = fresh();
    const hash = await wallet(KEYS.executor).sendTransaction({
      account: executor,
      to: accountSigner.address,
      data: encodeFunctionData({
        abi: guardExecuteAbi,
        functionName: "execute",
        args: [pinId, attested, [{ target: TARGET, value: 0n, data: SWAP }]],
      }),
      gas: 500_000n,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    expect(receipt.status, "the premise: the attempt reverted on chain").toBe("reverted");

    const watcher = new Watcher({ rpcUrl: RPC, chainId: 10143, registry, watchedAccounts: [accountSigner.address] });
    const head = await headNow();
    const scan = await watcher.blockedAttempts(receipt.blockNumber, head + 2n);

    expect(scan.attempts).toHaveLength(1);
    expect(scan.attempts[0]!.reason).toBe("skill version does not match the approved pin");
    expect(scan.attempts[0]!.attestedSkillHash).toBe(attested);
    expect(scan.attempts[0]!.pinnedSkillHash).toBe(skillHash);
    // The two blocks past the head do not exist. They are a gap, and the result says so.
    expect(scan.unreadable).toEqual([head + 1n, head + 2n]);
  }, 180_000);
});
