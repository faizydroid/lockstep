/**
 * `lockstep publish` and where it puts the badge.
 *
 * It used to write the SVG into the skill directory it had just pinned. The canonical hash covers every
 * file in that directory, so the badge changed the hash the moment it landed: the pin on chain
 * described bytes that were no longer on disk, `lockstep approve` found no pin for the directory, and
 * running publish again was refused as equivocation. The CLI's own advice ("commit the SVG alongside
 * your README") broke the pin it had just created.
 *
 * Local Anvil on port 8556, started as chain id 10143 so the CLI's chain check passes.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPublicClient, createWalletClient, http, toFunctionSelector, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

import { hashSkillDirectory } from "@lockstep/runtime";
import { badgeDirectory, publishCommand } from "../src/commands/publish.ts";

const ROOT = resolve(__dirname, "../..");
const ANVIL = join(ROOT, ".tools", "foundry", process.platform === "win32" ? "anvil.exe" : "anvil");
const PORT = 8556;
const RPC = `http://127.0.0.1:${PORT}`;
const KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const me = privateKeyToAccount(KEY);
const ONE = 1_000_000n;
const chain = { ...monadTestnet, rpcUrls: { default: { http: [RPC] } } };

let anvil: ChildProcess;
let work = "";
let registry: Address;
let registryAbi: never;
const client = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account: me, chain, transport: http(RPC) });

const available = existsSync(ANVIL);

async function quiet<T>(fn: () => Promise<T>): Promise<{ value: T; out: string }> {
  let out = "";
  const a = vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => ((out += String(c)), true));
  const b = vi.spyOn(process.stderr, "write").mockImplementation((c: string | Uint8Array) => ((out += String(c)), true));
  try {
    return { value: await fn(), out };
  } finally {
    a.mockRestore();
    b.mockRestore();
  }
}

beforeAll(async () => {
  if (!available) return;
  work = await mkdtemp(join(tmpdir(), "lockstep-publish-badge-"));
  anvil = spawn(ANVIL, ["--port", String(PORT), "--chain-id", "10143", "--silent"] /* anvil maps 10143 to its monad network config, which refuses --hardfork */, { stdio: "ignore" });
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
  const load = async (p: string) => JSON.parse(await readFile(join(ROOT, "contracts", "out", p), "utf8"));
  const bond = await load("Deploy.s.sol/MockBondAsset.json");
  const reg = await load("PinRegistry.sol/PinRegistry.json");
  registryAbi = reg.abi as never;
  const deploy = async (a: { abi: never; bytecode: { object: Hex } }, args: unknown[]) =>
    (await client.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args } as never) }))
      .contractAddress as Address;
  const token = await deploy(bond, []);
  registry = await deploy(reg, [token, 100n * ONE, 25n * ONE, 500n * ONE, 500n * ONE, 604800n, 5000n, me.address, [
    toFunctionSelector("approve(address,uint256)"), toFunctionSelector("transfer(address,uint256)"),
  ]]);
  const w = async (args: object) => client.waitForTransactionReceipt({ hash: await wallet.writeContract(args as never) });
  await w({ address: token, abi: bond.abi, functionName: "mint", args: [me.address, 10_000n * ONE] });
  await w({ address: token, abi: bond.abi, functionName: "approve", args: [registry, 10_000n * ONE] });
  await w({ address: registry, abi: registryAbi, functionName: "deposit", args: [10_000n * ONE] });

  process.env.RPC_URL = RPC;
  process.env.CHAIN_ID = "10143";
  process.env.PIN_REGISTRY = registry;
  process.env.ACCOUNT_ADDRESS = me.address;
  process.env.PUBLISHER_PRIVATE_KEY = KEY;
}, 180_000);

afterAll(async () => {
  anvil?.kill();
  for (const k of ["RPC_URL", "CHAIN_ID", "PIN_REGISTRY", "ACCOUNT_ADDRESS", "PUBLISHER_PRIVATE_KEY"]) delete process.env[k];
  if (work) await rm(work, { recursive: true, force: true });
});

describe("badgeDirectory", () => {
  it("is the current directory when that is outside the skill", () => {
    const skill = join(tmpdir(), "repo", "skills", "x");
    expect(badgeDirectory(skill, join(tmpdir(), "repo"))).toBe(resolve(tmpdir(), "repo"));
  });

  it("is the skill's parent when the current directory is the skill, or inside it", () => {
    const skill = join(tmpdir(), "repo", "skills", "x");
    const parent = resolve(tmpdir(), "repo", "skills");
    expect(badgeDirectory(skill, skill)).toBe(parent);
    expect(badgeDirectory(skill, join(skill, "scripts"))).toBe(parent);
  });

  it("does not mistake a sibling whose name starts with the skill's for the skill", () => {
    const skill = join(tmpdir(), "repo", "skills", "x");
    const sibling = join(tmpdir(), "repo", "skills", "x-evil");
    expect(badgeDirectory(skill, sibling)).toBe(resolve(sibling));
  });
});

describe.skipIf(!available)("publish leaves the pinned directory exactly as it was pinned", () => {
  it("writes the badge outside the skill, and the directory still hashes to the pin", async () => {
    const dir = join(work, "kuru-quote");
    const out = join(work, "readme-dir");
    await mkdir(out, { recursive: true });
    await cp(join(ROOT, "demo", "skills", "kuru-quote"), dir, { recursive: true });
    const before = (await hashSkillDirectory(dir)).skillHash;
    const filesBefore = (await readdir(dir)).sort();

    const result = await quiet(() => publishCommand({ skillDir: dir, manifestPath: undefined, dryRun: false, badgeDir: out }));
    expect(result.value).toBe(0);

    const after = (await hashSkillDirectory(dir)).skillHash;
    const pinId = (await client.readContract({ address: registry, abi: registryAbi, functionName: "computePinId", args: [me.address, before] } as never)) as Hex;
    const pinnedHash = (await client.readContract({ address: registry, abi: registryAbi, functionName: "liveSkillHash", args: [pinId] } as never)) as Hex;

    expect(pinnedHash).toBe(before);
    expect(after, "the CLI must not have changed the bytes it just pinned").toBe(before);
    expect((await readdir(dir)).sort()).toEqual(filesBefore);
    expect((await readdir(out)).filter((f) => f.endsWith(".svg"))).toEqual(["lockstep-kuru-quote.svg"]);
  }, 60_000);

  it("refuses to write the badge inside the skill even when asked to, and the pin is unaffected", async () => {
    const dir = join(work, "kuru-quote-two");
    await cp(join(ROOT, "demo", "skills", "kuru-quote"), dir, { recursive: true });
    const manifest = JSON.parse(await readFile(join(dir, "lockstep.json"), "utf8"));
    manifest.version = "5.0.0"; // a different version, so this is not the first test's pin again
    await writeFile(join(dir, "lockstep.json"), JSON.stringify(manifest));
    const before = (await hashSkillDirectory(dir)).skillHash;

    const result = await quiet(() => publishCommand({ skillDir: dir, manifestPath: undefined, dryRun: false, badgeDir: join(dir, "badges") }));

    expect(result.value).toBe(0);
    expect(result.out).toContain("pin published");
    expect(result.out).toContain("not written");
    expect((await hashSkillDirectory(dir)).skillHash).toBe(before);
    expect(existsSync(join(dir, "badges"))).toBe(false);
  }, 60_000);
});
// Negative result: the hasher rejects symlinks before publish writes anything, so a planted symlink
// cannot redirect the badge write. Kept as a regression test.
describe.skipIf(!available)("a symlink planted at the badge path", () => {
  it("is refused by the hasher before any file is written", async () => {
    const { symlink, writeFile: wf, readFile: rf } = await import("node:fs/promises");
    const dir = join(work, "vendored-skill");
    await cp(join(ROOT, "demo", "skills", "kuru-quote"), dir, { recursive: true });
    // A different version so the self-slash refusal does not fire.
    const manifest = JSON.parse(await rf(join(dir, "lockstep.json"), "utf8"));
    manifest.version = "4.0.0";
    await wf(join(dir, "lockstep.json"), JSON.stringify(manifest));
    const victim = join(work, "victim-outside-skill-dir.txt");
    await wf(victim, "ORIGINAL CONTENT\n");
    await symlink(victim, join(dir, "lockstep-kuru-quote.svg"), "file");

    await expect(quiet(() => publishCommand({ skillDir: dir, manifestPath: undefined, dryRun: false, badgeDir: work }))).rejects.toThrow(/Symlink cannot be pinned/);
    expect(await rf(victim, "utf8")).toBe("ORIGINAL CONTENT\n");
  }, 60_000);
});