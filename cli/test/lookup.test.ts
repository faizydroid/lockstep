/**
 * `lockstep approve`, `diff` and `status` on an RPC that refuses `eth_getLogs`, the way Monad's public endpoint does.
 *
 * They used to find the pin by replaying `Published` events from block zero, so on Monad's RPC none of
 * them could run, and on a chain where they could, `approve` took whichever pin for the same bytes had
 * been published first, from anyone, without printing the publisher. The audit's two proofs of concept
 * for that are the tests below.
 *
 * A local Anvil on port 8557 behind a proxy on 8558 that counts every method and answers `eth_getLogs`
 * with HTTP 413 and code -32614, which is what Monad returns.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

import { hashSkillDirectory } from "@lockstep/runtime";
import { lockstepGuardAbi } from "../src/abi.ts";
import { approveCommand } from "../src/commands/approve.ts";
import { diffCommand, type LookupFlags } from "../src/commands/diff.ts";
import { statusCommand } from "../src/commands/status.ts";
import {
  approvalState,
  computePinId,
  delegateOf,
  isLogRangeRefusal,
  parseAddressList,
  parsePinId,
  readPin,
  resolvePin,
} from "../src/lookup.ts";
import { loadManifest } from "../src/manifest.ts";

const ROOT = resolve(__dirname, "../..");
const ANVIL = join(ROOT, ".tools", "foundry", process.platform === "win32" ? "anvil.exe" : "anvil");
const CHAIN_PORT = 8557;
const PROXY_PORT = 8558;
const CHAIN_RPC = `http://127.0.0.1:${CHAIN_PORT}`;
const RPC = `http://127.0.0.1:${PROXY_PORT}`;
const ONE = 1_000_000n;

const KEYS = {
  honest: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  attacker: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  account: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  bystander: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const;
const honest = privateKeyToAccount(KEYS.honest);
const attacker = privateKeyToAccount(KEYS.attacker);
const accountSigner = privateKeyToAccount(KEYS.account);
const bystander = privateKeyToAccount(KEYS.bystander);

const chain = { ...monadTestnet, rpcUrls: { default: { http: [CHAIN_RPC] } } };
const client = createPublicClient({ chain, transport: http(CHAIN_RPC) });
const wallet = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(CHAIN_RPC) });

const T1: Address = "0x1111111111111111111111111111111111111111";
const T2: Address = "0x2222222222222222222222222222222222222222";
const APPROVE = "approve(address,uint256)";
const TRANSFER = "transfer(address,uint256)";
const TRANSFER_FROM = "transferFrom(address,address,uint256)";
const BALANCE_OF = "balanceOf(address)";
const SWAP = "swap(uint256)";

const available = existsSync(ANVIL);

let anvil: ChildProcess;
let proxy: Server;
let work = "";
let registry: Address;
let guard: Address;
let registryAbi: never;
const seen = new Map<string, number>();

const NO_FLAGS: LookupFlags = { publishers: [], pin: undefined, previous: undefined, fromBlock: undefined };

async function artifact(path: string) {
  return JSON.parse(await readFile(join(ROOT, "contracts", "out", path), "utf8"));
}

async function mined(hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("a setup transaction reverted");
  return receipt;
}

/** A skill directory whose manifest declares exactly `calls`, and whose bytes are unique per `marker`. */
async function skill(name: string, version: string, marker: string, calls: [Address, string][], maxValue = "0") {
  const dir = join(work, `${name}-${version}-${marker}`);
  await cp(join(ROOT, "demo", "skills", "kuru-quote"), dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `${await readFile(join(dir, "SKILL.md"), "utf8")}\n<!-- ${marker} -->\n`);
  await writeFile(
    join(dir, "lockstep.json"),
    JSON.stringify({
      schema: "lockstep/1",
      name,
      version,
      capabilities: { onchain: { calls: calls.map(([target, selector]) => ({ target, selector })), maxValuePerBatch: maxValue } },
    }),
  );
  return dir;
}

/** Publishes `dir`'s bytes with whatever capabilities `declared` says, which need not be what its manifest says. */
async function publishAs(
  key: Hex,
  dir: string,
  declared?: { calls: [Address, string][]; maxValue?: bigint },
): Promise<Hex> {
  const manifest = await loadManifest(dir);
  const { skillHash } = await hashSkillDirectory(dir);
  const calls = declared?.calls ?? manifest.capabilities.map((c) => [c.target, c.label] as [Address, string]);
  await mined(
    await wallet(key).writeContract({
      address: registry,
      abi: registryAbi,
      functionName: "publish",
      args: [
        {
          name: manifest.name,
          version: manifest.version,
          skillHash,
          maxValuePerBatch: declared?.maxValue ?? manifest.maxValuePerBatch,
          targets: calls.map(([t]) => t),
          selectors: calls.map(([, s]) => toFunctionSelector(s)),
        },
      ],
    } as never),
  );
  return computePinId(privateKeyToAccount(key).address, skillHash);
}

async function run(command: () => Promise<number>): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const a = vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => ((stdout += String(c)), true));
  const b = vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => ((stderr += String(c)), true));
  try {
    return { code: await command(), stdout, stderr };
  } finally {
    a.mockRestore();
    b.mockRestore();
  }
}

const rpcCalls = (method: string) => seen.get(method) ?? 0;

beforeAll(async () => {
  if (!available) return;
  work = await mkdtemp(join(tmpdir(), "lockstep-cli-lookup-"));

  anvil = spawn(ANVIL, ["--port", String(CHAIN_PORT), "--chain-id", "10143", "--silent"], { stdio: "ignore" });
  const deadline = Date.now() + 100_000;
  for (;;) {
    try {
      await client.getBlockNumber();
      break;
    } catch {
      if (Date.now() > deadline) throw new Error("anvil did not start");
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Monad's public RPC, as far as this test needs it: every method is forwarded and counted, and a log
  // query is refused with the status and code Monad uses.
  proxy = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      let method = "";
      let id: unknown = 1;
      try {
        const parsed = JSON.parse(body) as { method?: string; id?: unknown };
        method = parsed.method ?? "";
        id = parsed.id ?? 1;
      } catch {
        /* forwarded as-is */
      }
      seen.set(method, rpcCalls(method) + 1);
      if (method === "eth_getLogs") {
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32614, message: "eth_getLogs is limited to a 100 range" } }));
        return;
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
    (await mined(await wallet(KEYS.honest).deployContract({ abi: a.abi, bytecode: a.bytecode.object, args } as never))).contractAddress as Address;
  const token = await deploy(bond, []);
  registry = getAddress(await deploy(reg, [
    token, 100n * ONE, 25n * ONE, 500n * ONE, 500n * ONE, 604800n, 5000n, honest.address,
    [toFunctionSelector(APPROVE), toFunctionSelector(TRANSFER)],
  ]));
  guard = getAddress(await deploy(guardArtifact, [registry]));

  for (const key of [KEYS.honest, KEYS.attacker]) {
    const who = privateKeyToAccount(key).address;
    await mined(await wallet(key).writeContract({ address: token, abi: bond.abi, functionName: "mint", args: [who, 100_000n * ONE] } as never));
    await mined(await wallet(key).writeContract({ address: token, abi: bond.abi, functionName: "approve", args: [registry, 100_000n * ONE] } as never));
    await mined(await wallet(key).writeContract({ address: registry, abi: registryAbi, functionName: "deposit", args: [100_000n * ONE] } as never));
  }

  // Fund the account that will be delegated to the guard, then delegate it.
  await mined(await wallet(KEYS.honest).sendTransaction({ to: accountSigner.address, value: 10n ** 18n }));
  const authorization = await wallet(KEYS.account).signAuthorization({ account: accountSigner, contractAddress: guard, executor: "self" });
  await mined(
    await wallet(KEYS.account).sendTransaction({
      account: accountSigner,
      to: accountSigner.address,
      // Any call into the guard will do; authorising an executor is a harmless one.
      data: encodeFunctionData({ abi: lockstepGuardAbi, functionName: "authorizeExecutor", args: [bystander.address] }),
      authorizationList: [authorization],
    }),
  );

  process.env.RPC_URL = RPC;
  process.env.CHAIN_ID = "10143";
  process.env.PIN_REGISTRY = registry;
  process.env.ACCOUNT_ADDRESS = accountSigner.address;
  delete process.env.TRUSTED_PUBLISHERS;
}, 240_000);

afterAll(async () => {
  anvil?.kill();
  await new Promise<void>((r) => (proxy ? proxy.close(() => r()) : r()));
  for (const k of ["RPC_URL", "CHAIN_ID", "PIN_REGISTRY", "ACCOUNT_ADDRESS", "ACCOUNT_PRIVATE_KEY", "TRUSTED_PUBLISHERS"]) delete process.env[k];
  if (work) await rm(work, { recursive: true, force: true });
});

describe("helpers", () => {
  it("computePinId matches the registry's own", async () => {
    if (!available) return;
    const { skillHash } = await hashSkillDirectory(join(ROOT, "demo", "skills", "kuru-quote"));
    const onChain = (await client.readContract({
      address: registry, abi: registryAbi, functionName: "computePinId", args: [honest.address, skillHash],
    } as never)) as Hex;
    expect(computePinId(honest.address, skillHash)).toBe(onChain);
  });

  it("reads a delegation designator and nothing else", () => {
    expect(delegateOf(`0xef0100${"ab".repeat(20)}`)).toBe(getAddress(`0x${"ab".repeat(20)}`));
    expect(delegateOf("0x")).toBeUndefined();
    expect(delegateOf(undefined)).toBeUndefined();
    expect(delegateOf(`0xef0200${"ab".repeat(20)}`)).toBeUndefined();
    expect(delegateOf(`0x6080${"ab".repeat(30)}`)).toBeUndefined();
  });

  it("parses repeated and comma-separated addresses, case-insensitively, and names the source of a bad one", () => {
    const a = honest.address.toLowerCase();
    expect(parseAddressList([`${a},${attacker.address}`, a], "--publisher")).toEqual([honest.address, attacker.address, honest.address]);
    expect(() => parseAddressList(["0x1234"], "--publisher")).toThrow(/--publisher: "0x1234" is not a 20-byte address/);
    expect(() => parseAddressList(["0x1234"], "TRUSTED_PUBLISHERS")).toThrow(/TRUSTED_PUBLISHERS/);
  });

  it("parses a pin id strictly", () => {
    expect(parsePinId(`0x${"AB".repeat(32)}`, "--pin")).toBe(`0x${"ab".repeat(32)}`);
    expect(() => parsePinId("0xabc", "--pin")).toThrow(/32-byte pin id/);
  });

  it("recognises how Monad's RPC refuses a log query, and not other errors", () => {
    expect(isLogRangeRefusal(new Error("HTTP request failed.\n\nStatus: 413\nDetails: eth_getLogs is limited to a 100 range"))).toBe(true);
    expect(isLogRangeRefusal(new Error('{"code":-32614,"message":"x"}'))).toBe(true);
    expect(isLogRangeRefusal(new Error("connect ECONNREFUSED 127.0.0.1:1"))).toBe(false);
    expect(isLogRangeRefusal(new Error("execution reverted"))).toBe(false);
  });
});

describe.skipIf(!available)("finding the pin without a log scan", () => {
  it("diff with a named publisher works on an RPC that refuses logs, and sends no log query", async () => {
    const dir = await skill("kuru-quote", "1.0.0", "plain", [[T1, APPROVE], [T1, TRANSFER]]);
    const pin = await publishAs(KEYS.honest, dir);
    seen.clear();

    const r = await run(() => diffCommand({ skillDir: dir, ...NO_FLAGS, publishers: [honest.address] }));

    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`publisher   ${honest.address}`);
    expect(r.stdout).toContain(`pin         ${pin}`);
    expect(r.stdout).toContain("each confirmed against the pin (2)");
    expect(r.stdout).toContain("[HIGH RISK");
    expect(r.stdout).toContain("no baseline");
    expect(rpcCalls("eth_call"), "the lookups must have gone to the chain").toBeGreaterThan(2);
    expect(rpcCalls("eth_getLogs"), "no log query may be sent when a publisher is named").toBe(0);
  }, 60_000);

  it("names the way out instead of guessing when no publisher is given and logs are refused", async () => {
    const dir = await skill("kuru-quote", "1.0.1", "no-publisher", [[T1, APPROVE]]);
    await publishAs(KEYS.honest, dir);
    seen.clear();

    const r = await run(() => diffCommand({ skillDir: dir, ...NO_FLAGS }));

    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--publisher");
    expect(r.stderr).toContain("TRUSTED_PUBLISHERS");
    expect(r.stdout).not.toContain("capabilities, from the manifest");
    expect(rpcCalls("eth_getLogs"), "it did try the scan, and was refused").toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("TRUSTED_PUBLISHERS is the same as --publisher", async () => {
    const dir = await skill("kuru-quote", "1.0.2", "env", [[T1, APPROVE]]);
    await publishAs(KEYS.honest, dir);
    process.env.TRUSTED_PUBLISHERS = honest.address;
    try {
      const r = await run(() => diffCommand({ skillDir: dir, ...NO_FLAGS }));
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain(`publisher   ${honest.address}`);
    } finally {
      delete process.env.TRUSTED_PUBLISHERS;
    }
  }, 60_000);

  it("falls back to the log scan, and finds the pin, when --from-block is given on a chain that allows it", async () => {
    // The proxy refuses logs, so go straight to the chain for this one: that is what a local chain is.
    const dir = await skill("kuru-quote", "1.0.3", "scan", [[T1, APPROVE]]);
    const pin = await publishAs(KEYS.honest, dir);
    const { skillHash } = await hashSkillDirectory(dir);
    const direct = await resolvePin(client as never, registry, skillHash, { publishers: [], pin: undefined, fromBlock: 0n });
    expect(direct.kind).toBe("found");
    expect(direct.kind === "found" && direct.pin.pinId).toBe(pin);
    expect(direct.kind === "found" && direct.via).toBe("logs");
  }, 60_000);
});

describe.skipIf(!available)("C2: someone else's pin for the same public bytes", () => {
  // The attacker publishes the exact bytes first, declaring more than the manifest lists and a native ceiling.
  let dir = "";
  let honestPin: Hex;
  let attackerPin: Hex;

  beforeAll(async () => {
    dir = await skill("squat-me", "1.0.0", "squat", [[T1, APPROVE], [T1, TRANSFER]]);
    attackerPin = await publishAs(KEYS.attacker, dir, {
      calls: [[T1, APPROVE], [T1, TRANSFER], [T2, TRANSFER_FROM]],
      maxValue: 5n * 10n ** 18n,
    });
    honestPin = await publishAs(KEYS.honest, dir);
  }, 120_000);

  it("refuses to choose between two live publishers, and names both", async () => {
    const r = await run(() => diffCommand({ skillDir: dir, ...NO_FLAGS, publishers: [attacker.address, honest.address] }));

    expect(r.code).toBe(1);
    expect(r.stderr).toContain("more than one publisher has a live pin");
    expect(r.stderr).toContain(attacker.address);
    expect(r.stderr).toContain(honest.address);
    expect(r.stderr).toContain(attackerPin);
    expect(r.stderr).toContain(honestPin);
    expect(r.stdout).not.toContain("approval");
  }, 60_000);

  it("approves nothing when two publishers are in play, even with --yes", async () => {
    process.env.ACCOUNT_PRIVATE_KEY = KEYS.account;
    try {
      const r = await run(() =>
        approveCommand({ skillDir: dir, ...NO_FLAGS, publishers: [attacker.address, honest.address], assumeYes: true }),
      );
      expect(r.code).toBe(1);
      expect(await approvalState(client as never, accountSigner.address, honestPin)).toBe("not-approved");
      expect(await approvalState(client as never, accountSigner.address, attackerPin)).toBe("not-approved");
    } finally {
      delete process.env.ACCOUNT_PRIVATE_KEY;
    }
  }, 60_000);

  it("shows the publisher's own pin when only they are named", async () => {
    const r = await run(() => diffCommand({ skillDir: dir, ...NO_FLAGS, publishers: [honest.address] }));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`publisher   ${honest.address}`);
    expect(r.stdout).toContain(`pin         ${honestPin}`);
    expect(r.stdout).not.toContain(attacker.address);
  }, 60_000);

  it("refuses the attacker's pin when it is named, because it allows more than the manifest shows", async () => {
    for (const flags of [{ publishers: [attacker.address] }, { pin: attackerPin }]) {
      const r = await run(() => diffCommand({ skillDir: dir, ...NO_FLAGS, ...flags }));
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("does not match the manifest");
      expect(r.stderr).toContain("allows 1 more capability than the manifest lists");
      expect(r.stderr).toContain("native value ceiling");
    }
  }, 60_000);

  it("refuses a --pin for different bytes", async () => {
    const other = await skill("other-skill", "1.0.0", "other", [[T2, SWAP]]);
    const otherPin = await publishAs(KEYS.honest, other);
    const r = await run(() => diffCommand({ skillDir: dir, ...NO_FLAGS, pin: otherPin }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("It is a pin for different bytes");
  }, 60_000);
});

describe.skipIf(!available)("a manifest that is not what the pin allows", () => {
  it("refuses when the pin lets a batch move native value the manifest does not declare", async () => {
    // Same capabilities, same bytes, but the pin carries a 3 MON ceiling the manifest never mentions.
    const dir = await skill("hidden-ceiling", "1.0.0", "ceiling", [[T1, SWAP]]);
    await publishAs(KEYS.attacker, dir, { calls: [[T1, SWAP]], maxValue: 3n * 10n ** 18n });
    const r = await run(() => diffCommand({ skillDir: dir, ...NO_FLAGS, publishers: [attacker.address] }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("native value ceiling: manifest 0 MON, pin 3 MON");
    expect(r.stderr).not.toContain("does NOT allow");
  }, 60_000);

  it("refuses when the manifest lists a power the pin lacks", async () => {
    const dir = await skill("short-pin", "1.0.0", "short", [[T1, SWAP], [T2, BALANCE_OF]]);
    await publishAs(KEYS.honest, dir, { calls: [[T1, SWAP]] });
    const r = await run(() => diffCommand({ skillDir: dir, ...NO_FLAGS, publishers: [honest.address] }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("does NOT allow what the manifest lists");
    expect(r.stderr).toContain(T2);
  }, 60_000);

  it("refuses when there is no manifest at all", async () => {
    const dir = await skill("no-manifest", "1.0.0", "bare", [[T1, SWAP]]);
    await publishAs(KEYS.honest, dir);
    await rm(join(dir, "lockstep.json"));
    const r = await run(() => diffCommand({ skillDir: dir, ...NO_FLAGS, publishers: [honest.address] }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("cannot read the capability manifest");
  }, 60_000);
});

describe.skipIf(!available)("C3: the baseline is the one you name, not the publisher's first approval of anything", () => {
  it("reports a widening against the previous version of the same skill", async () => {
    const v1 = await skill("skill-b", "1.0.0", "b1", [[T1, BALANCE_OF]]);
    const v2 = await skill("skill-b", "2.0.0", "b2", [[T1, APPROVE], [T1, TRANSFER]]);
    const pinB1 = await publishAs(KEYS.honest, v1);
    await publishAs(KEYS.honest, v2);

    const r = await run(() => diffCommand({ skillDir: v2, ...NO_FLAGS, publishers: [honest.address], previous: pinB1 }));

    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`baseline    ${pinB1}`);
    expect(r.stdout).toMatch(/\+ 0x1111111111111111111111111111111111111111 {2}approve\(address,uint256\) {2}\[HIGH RISK/);
    expect(r.stdout).toContain("This version can do things the baseline could not");
    expect(r.stdout).toContain("- 1 capability the baseline allowed and this does not");
    expect(r.stdout).not.toContain("auto-approvable");
  }, 90_000);

  it("is not fooled by a wider pin of an unrelated skill from the same publisher", async () => {
    // Skill A allows approve + transfer. Skill B 2.0.0 allows the same, so against A it adds nothing, but
    // against B 1.0.0 it adds both. Which one is the baseline is the reader's statement, not an inference.
    const a = await skill("skill-a", "1.0.0", "a1", [[T1, APPROVE], [T1, TRANSFER]]);
    const b1 = await skill("skill-b2", "1.0.0", "bb1", [[T1, BALANCE_OF]]);
    const b2 = await skill("skill-b2", "2.0.0", "bb2", [[T1, APPROVE], [T1, TRANSFER]]);
    const pinA = await publishAs(KEYS.honest, a);
    const pinB1 = await publishAs(KEYS.honest, b1);
    await publishAs(KEYS.honest, b2);

    const against = async (previous: Hex) =>
      (await run(() => diffCommand({ skillDir: b2, ...NO_FLAGS, publishers: [honest.address], previous }))).stdout;

    expect(await against(pinB1)).toContain("This version can do things the baseline could not");
    expect(await against(pinA)).not.toContain("This version can do things the baseline could not");
    expect(await against(pinA)).toContain("capabilities did not widen");
  }, 120_000);

  it("says plainly that it is showing everything when no baseline is given", async () => {
    const dir = await skill("skill-nb", "1.0.0", "nb", [[T1, SWAP]]);
    await publishAs(KEYS.honest, dir);
    const r = await run(() => diffCommand({ skillDir: dir, ...NO_FLAGS, publishers: [honest.address] }));
    expect(r.stdout).toContain("no baseline: this shows everything the version can do, not what changed");
  }, 60_000);

  it("refuses a --previous that is not a pin", async () => {
    const dir = await skill("skill-np", "1.0.0", "np", [[T1, SWAP]]);
    await publishAs(KEYS.honest, dir);
    const r = await run(() => diffCommand({ skillDir: dir, ...NO_FLAGS, publishers: [honest.address], previous: `0x${"ee".repeat(32)}` }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("is not a pin in this registry");
  }, 60_000);
});

describe.skipIf(!available)("a revoked pin", () => {
  it("is refused rather than approved", async () => {
    const dir = await skill("revoke-me", "1.0.0", "rev", [[T1, SWAP]]);
    const pin = await publishAs(KEYS.honest, dir);
    await mined(await wallet(KEYS.honest).writeContract({ address: registry, abi: registryAbi, functionName: "revoke", args: [pin] } as never));
    const r = await run(() => diffCommand({ skillDir: dir, ...NO_FLAGS, publishers: [honest.address] }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("is revoked");
    expect((await readPin(client as never, registry, pin))?.revoked).toBe(true);
  }, 60_000);
});

describe.skipIf(!available)("approve", () => {
  it("approves the named publisher's pin, prints the publisher, and the account then holds the approval", async () => {
    const dir = await skill("approve-me", "1.0.0", "appr", [[T1, APPROVE], [T1, TRANSFER]]);
    const pin = await publishAs(KEYS.honest, dir);
    process.env.ACCOUNT_PRIVATE_KEY = KEYS.account;
    try {
      expect(await approvalState(client as never, accountSigner.address, pin)).toBe("not-approved");
      seen.clear();

      const r = await run(() => approveCommand({ skillDir: dir, ...NO_FLAGS, publishers: [honest.address], assumeYes: true }));

      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain(`publisher   ${honest.address}`);
      expect(r.stdout).toContain(`approved    ${pin}`);
      expect(r.stdout).toContain("status      success");
      expect(await approvalState(client as never, accountSigner.address, pin)).toBe("approved");
      expect(rpcCalls("eth_getLogs")).toBe(0);

      // And a second run knows it is done, and sends nothing.
      const nonce = await client.getTransactionCount({ address: accountSigner.address });
      const again = await run(() => approveCommand({ skillDir: dir, ...NO_FLAGS, publishers: [honest.address], assumeYes: true }));
      expect(again.code).toBe(0);
      expect(again.stdout).toContain("already approved by this account");
      expect(await client.getTransactionCount({ address: accountSigner.address })).toBe(nonce);
    } finally {
      delete process.env.ACCOUNT_PRIVATE_KEY;
    }
  }, 120_000);

  it("will not send an approval from an account that carries no delegation", async () => {
    const dir = await skill("approve-plain", "1.0.0", "plain-acct", [[T1, SWAP]]);
    await publishAs(KEYS.honest, dir);
    // An account with no code: the transaction would succeed and store nothing.
    process.env.ACCOUNT_ADDRESS = attacker.address;
    process.env.ACCOUNT_PRIVATE_KEY = KEYS.attacker;
    try {
      const nonce = await client.getTransactionCount({ address: attacker.address });
      const r = await run(() => approveCommand({ skillDir: dir, ...NO_FLAGS, publishers: [honest.address], assumeYes: true }));
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("carries no EIP-7702 delegation");
      expect(await client.getTransactionCount({ address: attacker.address })).toBe(nonce);
    } finally {
      process.env.ACCOUNT_ADDRESS = accountSigner.address;
      delete process.env.ACCOUNT_PRIVATE_KEY;
    }
  }, 60_000);

  it("will not send an approval for a pin whose manifest does not match, even with --yes", async () => {
    const dir = await skill("approve-mismatch", "1.0.0", "mm", [[T1, SWAP]]);
    const pin = await publishAs(KEYS.attacker, dir, { calls: [[T1, SWAP], [T2, TRANSFER_FROM]] });
    process.env.ACCOUNT_PRIVATE_KEY = KEYS.account;
    try {
      const r = await run(() => approveCommand({ skillDir: dir, ...NO_FLAGS, publishers: [attacker.address], assumeYes: true }));
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("does not match the manifest");
      expect(await approvalState(client as never, accountSigner.address, pin)).toBe("not-approved");
    } finally {
      delete process.env.ACCOUNT_PRIVATE_KEY;
    }
  }, 60_000);
});

describe.skipIf(!available)("status", () => {
  it("reports delegation, and for a named pin whether it is live, approved and still on disk", async () => {
    const dir = await skill("status-me", "1.0.0", "st", [[T1, SWAP]]);
    const pin = await publishAs(KEYS.honest, dir);
    process.env.ACCOUNT_PRIVATE_KEY = KEYS.account;
    try {
      await run(() => approveCommand({ skillDir: dir, ...NO_FLAGS, publishers: [honest.address], assumeYes: true }));
    } finally {
      delete process.env.ACCOUNT_PRIVATE_KEY;
    }
    seen.clear();

    const r = await run(() => statusCommand({ skillDir: dir, publishers: [honest.address], pins: [], fromBlock: undefined }));

    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`delegation  ${guard}`);
    expect(r.stdout).toContain(pin);
    expect(r.stdout).toContain("status      live");
    expect(r.stdout).toContain("approved    yes");
    expect(r.stdout).toContain("on disk     matches");
    expect(r.stdout).toContain("manifest    matches the pin exactly");
    expect(rpcCalls("eth_getLogs")).toBe(0);
  }, 120_000);

  it("says an approved pin no longer matches once the directory changes", async () => {
    const dir = await skill("status-drift", "1.0.0", "drift", [[T1, SWAP]]);
    const pin = await publishAs(KEYS.honest, dir);
    process.env.ACCOUNT_PRIVATE_KEY = KEYS.account;
    try {
      await run(() => approveCommand({ skillDir: dir, ...NO_FLAGS, publishers: [honest.address], assumeYes: true }));
    } finally {
      delete process.env.ACCOUNT_PRIVATE_KEY;
    }
    await writeFile(join(dir, "SKILL.md"), `${await readFile(join(dir, "SKILL.md"), "utf8")}\nchanged after approval\n`);

    const r = await run(() => statusCommand({ skillDir: dir, publishers: [], pins: [pin], fromBlock: undefined }));

    expect(r.stdout).toContain("approved    yes");
    expect(r.stdout).toContain("on disk     DIFFERS");
    expect(r.stdout).toContain("1 approval(s) no longer match the directory you passed");
  }, 120_000);

  it("warns first when the account carries no delegation", async () => {
    process.env.ACCOUNT_ADDRESS = bystander.address;
    try {
      const r = await run(() => statusCommand({ skillDir: undefined, publishers: [], pins: [`0x${"cd".repeat(32)}`], fromBlock: undefined }));
      expect(r.stdout).toContain("delegation  NONE");
      expect(r.stdout).toContain("no such pin in the registry");
    } finally {
      process.env.ACCOUNT_ADDRESS = accountSigner.address;
    }
  }, 60_000);

  it("explains what to do instead when it would have to scan logs and the RPC refuses", async () => {
    const r = await run(() => statusCommand({ skillDir: undefined, publishers: [], pins: [], fromBlock: undefined }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("cannot list approvals");
    expect(r.stderr).toContain("--publisher");
  }, 60_000);
});
