/**
 * The GitHub Action against a real chain.
 *
 * The action's whole value is two refusals: it will not publish a second conflicting
 * claim about one version (which would be self-slashing), and it fails the job when a
 * manifest widens capability. Both are claims about behaviour under conditions that
 * only exist on a chain, so they are tested here rather than mocked.
 *
 * Runs `main()` directly with the runner's environment simulated: `INPUT_*` variables,
 * `GITHUB_OUTPUT`, and `GITHUB_STEP_SUMMARY` pointing at temp files.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { main, ActionFailure } from "@lockstep/action/main";

const ROOT = resolve(import.meta.dirname, "..", "..");
const FOUNDRY_BIN = join(ROOT, ".tools", "foundry");
const ANVIL = join(FOUNDRY_BIN, process.platform === "win32" ? "anvil.exe" : "anvil");
const FORGE = join(FOUNDRY_BIN, process.platform === "win32" ? "forge.exe" : "forge");

const PORT = 8550;
const RPC = `http://127.0.0.1:${PORT}`;
const PUBLISHER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;

const registryAbi = parseAbi([
  "function deposit(uint256 amount)",
  "function bondAsset() view returns (address)",
  "function versionPinCount(address publisher, bytes32 versionId) view returns (uint256)",
]);
const bondAssetAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const available = existsSync(ANVIL) && existsSync(FORGE);

/** Snapshot and restore process.env around each case. */
const ORIGINAL_ENV = { ...process.env };

interface RunResult {
  readonly outputs: Record<string, string>;
  readonly summary: string;
}

describe.skipIf(!available)("lockstep GitHub Action against a live chain", () => {
  let anvil: ChildProcess;
  let client: PublicClient;
  let registry: Address;
  const publisher = privateKeyToAccount(PUBLISHER_PK);
  const tempDirs: string[] = [];

  const wallet = () =>
    createWalletClient({ account: publisher, chain: foundry, transport: http(RPC) });
  const send = async (hash: Hex) => client.waitForTransactionReceipt({ hash });

  /** A skill directory with a manifest, written fresh so each case controls its bytes. */
  async function makeSkill(options: {
    readonly name: string;
    readonly version: string;
    readonly body: string;
    readonly calls: readonly { target: string; selector: string }[];
  }): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "lockstep-action-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "SKILL.md"), `---\nname: ${options.name}\n---\n\n${options.body}\n`);
    await writeFile(
      join(dir, "lockstep.json"),
      JSON.stringify(
        {
          schema: "lockstep/1",
          name: options.name,
          version: options.version,
          capabilities: { onchain: { calls: options.calls, maxValuePerCall: "0" } },
        },
        null,
        2,
      ),
    );
    return dir;
  }

  async function run(inputs: Record<string, string>): Promise<RunResult> {
    const dir = await mkdtemp(join(tmpdir(), "lockstep-gh-"));
    tempDirs.push(dir);
    const outputFile = join(dir, "output");
    const summaryFile = join(dir, "summary");
    await writeFile(outputFile, "");
    await writeFile(summaryFile, "");

    process.env.GITHUB_OUTPUT = outputFile;
    process.env.GITHUB_STEP_SUMMARY = summaryFile;
    for (const [key, value] of Object.entries(inputs)) {
      process.env[`INPUT_${key.toUpperCase().replace(/-/g, "_")}`] = value;
    }

    await main();

    // Parse the heredoc form the action writes.
    const raw = await readFile(outputFile, "utf8");
    const outputs: Record<string, string> = {};
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const header = /^([A-Za-z0-9_-]+)<<(\S+)$/.exec(lines[i] ?? "");
      if (header === null) continue;
      const [, key, delimiter] = header;
      const collected: string[] = [];
      for (let j = i + 1; j < lines.length && lines[j] !== delimiter; j += 1) {
        collected.push(lines[j]!);
      }
      outputs[key!] = collected.join("\n");
    }

    return { outputs, summary: await readFile(summaryFile, "utf8") };
  }

  beforeAll(async () => {
    anvil = spawn(ANVIL, ["--port", String(PORT), "--silent", "--hardfork", "prague"], {
      stdio: "ignore",
    });
    client = createPublicClient({ chain: foundry, transport: http(RPC) }) as PublicClient;

    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        await client.getBlockNumber();
        break;
      } catch {
        if (Date.now() > deadline) throw new Error("anvil did not start within 30s");
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    const deploy = spawn(
      FORGE,
      ["script", "script/Deploy.s.sol", "--tc", "Deploy", "--root", join(ROOT, "contracts"),
       "--rpc-url", RPC, "--broadcast", "--private-key", PUBLISHER_PK, "--json"],
      { cwd: join(ROOT, "contracts"), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    deploy.stdout?.on("data", (c) => (stdout += String(c)));
    // stderr has to be drained, not just piped. forge writes warnings and the real failure
    // reason there, and an unread pipe stops forge dead once the OS buffer fills, which
    // turns a warning into a hang. Reporting it also means a failure here is diagnosable
    // instead of just "exited non-zero" next to a successful-looking trace.
    deploy.stderr?.on("data", (c) => (stderr += String(c)));
    const code = await new Promise<number>((r) => deploy.on("close", (c) => r(c ?? 1)));
    if (code !== 0) throw new Error(`forge script exited ${code}\n--- stderr ---\n${stderr}\n--- stdout ---\n${stdout}`);

    const line = stdout.split("\n").map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return undefined; } })
      .find((p) => p !== undefined && "returns" in p);
    const returns = (line as { returns: Record<string, { value: string }> }).returns;
    registry = getAddress((returns.registry ?? returns["0"]!).value);

    const bondAsset = (await client.readContract({
      address: registry, abi: registryAbi, functionName: "bondAsset",
    })) as Address;

    const funding = 10_000_000_000n; // 10,000 units at 6 decimals
    await send(await wallet().writeContract({ address: bondAsset, abi: bondAssetAbi, functionName: "mint", args: [publisher.address, funding], chain: foundry, account: publisher }));
    await send(await wallet().writeContract({ address: bondAsset, abi: bondAssetAbi, functionName: "approve", args: [registry, funding], chain: foundry, account: publisher }));
    await send(await wallet().writeContract({ address: registry, abi: registryAbi, functionName: "deposit", args: [funding], chain: foundry, account: publisher }));
  }, 180_000);

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("INPUT_") || key === "GITHUB_OUTPUT" || key === "GITHUB_STEP_SUMMARY") {
        delete process.env[key];
      }
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  afterAll(async () => {
    anvil?.kill();
    await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  const ROUTER = "0x1111111111111111111111111111111111111111";
  const TOKEN = "0x2222222222222222222222222222222222222222";
  const base = () => ({
    "rpc-url": RPC,
    "chain-id": "10143",
    "pin-registry": registry,
  });

  // --- dry run needs no key, which is the point of it on pull requests ---

  it("hashes and prices without a key in dry-run mode", async () => {
    const skill = await makeSkill({
      name: "act-dry", version: "1.0.0", body: "dry",
      calls: [{ target: ROUTER, selector: "swap(uint256)" }],
    });

    const { outputs, summary } = await run({ ...base(), "skill-dir": skill, "dry-run": "true" });

    expect(outputs["skill-hash"]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(outputs["version-id"]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(BigInt(outputs["bond-required"]!)).toBeGreaterThan(0n);
    expect(outputs["pin-id"]).toBeUndefined();
    expect(summary).toContain("act-dry 1.0.0");
    expect(summary).toContain("Declared capabilities (1)");
  }, 60_000);

  /** A high-risk capability must be visible in review, not buried in a bond number. */
  it("marks a high-risk capability in the job summary", async () => {
    const skill = await makeSkill({
      name: "act-risk", version: "1.0.0", body: "risky",
      calls: [{ target: TOKEN, selector: "approve(address,uint256)" }],
    });

    const { summary } = await run({ ...base(), "skill-dir": skill, "dry-run": "true" });

    expect(summary).toContain("grants spending allowance");
    expect(summary).toContain("⚠️");
  }, 60_000);

  it("prices a wider manifest higher than a narrow one", async () => {
    const narrow = await makeSkill({
      name: "act-narrow", version: "1.0.0", body: "n",
      calls: [{ target: ROUTER, selector: "swap(uint256)" }],
    });
    const wide = await makeSkill({
      name: "act-wide", version: "1.0.0", body: "w",
      calls: [
        { target: ROUTER, selector: "swap(uint256)" },
        { target: TOKEN, selector: "approve(address,uint256)" },
      ],
    });

    const a = await run({ ...base(), "skill-dir": narrow, "dry-run": "true" });
    const b = await run({ ...base(), "skill-dir": wide, "dry-run": "true" });

    expect(BigInt(b.outputs["bond-required"]!)).toBeGreaterThan(
      BigInt(a.outputs["bond-required"]!),
    );
  }, 60_000);

  it("requires a key when not dry running", async () => {
    const skill = await makeSkill({
      name: "act-nokey", version: "1.0.0", body: "x",
      calls: [{ target: ROUTER, selector: "swap(uint256)" }],
    });

    await expect(run({ ...base(), "skill-dir": skill })).rejects.toThrow(
      /publisher-private-key is required/,
    );
  }, 60_000);

  // --- publishing ---

  it("publishes a pin and reports its id", async () => {
    const skill = await makeSkill({
      name: "act-publish", version: "1.0.0", body: "publish me",
      calls: [{ target: ROUTER, selector: "swap(uint256)" }],
    });

    const { outputs, summary } = await run({
      ...base(), "skill-dir": skill, "publisher-private-key": PUBLISHER_PK,
    });

    expect(outputs["pin-id"]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(summary).toContain("Published");

    const claims = (await client.readContract({
      address: registry, abi: registryAbi, functionName: "versionPinCount",
      args: [publisher.address, outputs["version-id"] as Hex],
    })) as bigint;
    expect(claims).toBe(1n);
  }, 120_000);

  /** Re-running an unchanged release must be a no-op, not an error. */
  it("treats an unchanged republish as already published", async () => {
    const skill = await makeSkill({
      name: "act-idem", version: "1.0.0", body: "same bytes",
      calls: [{ target: ROUTER, selector: "swap(uint256)" }],
    });
    const inputs = { ...base(), "skill-dir": skill, "publisher-private-key": PUBLISHER_PK };

    const first = await run(inputs);
    const second = await run(inputs);

    expect(second.outputs["pin-id"]).toBe(first.outputs["pin-id"]);
  }, 120_000);

  /**
   * The refusal that matters most. Changing code without bumping the version would be
   * provable equivocation, and anyone could then take the publisher's bond. The
   * overwhelmingly likely cause is a forgotten version bump, so it is blocked rather
   * than confirmed.
   */
  it("refuses to publish a second conflicting claim about one version", async () => {
    const v1 = await makeSkill({
      name: "act-equiv", version: "1.0.0", body: "original bytes",
      calls: [{ target: ROUTER, selector: "swap(uint256)" }],
    });
    await run({ ...base(), "skill-dir": v1, "publisher-private-key": PUBLISHER_PK });

    // Same name and version, different bytes.
    const tampered = await makeSkill({
      name: "act-equiv", version: "1.0.0", body: "DIFFERENT bytes",
      calls: [{ target: ROUTER, selector: "swap(uint256)" }],
    });

    await expect(
      run({ ...base(), "skill-dir": tampered, "publisher-private-key": PUBLISHER_PK }),
    ).rejects.toThrow(/provable equivocation/i);
  }, 120_000);

  /** A widened blast radius must be a red check, not a silent release. */
  it("fails the job when the manifest widens capability", async () => {
    const narrow = await makeSkill({
      name: "act-widen", version: "1.0.0", body: "narrow",
      calls: [{ target: ROUTER, selector: "swap(uint256)" }],
    });
    await run({ ...base(), "skill-dir": narrow, "publisher-private-key": PUBLISHER_PK });

    const wider = await makeSkill({
      name: "act-widen", version: "2.0.0", body: "wider",
      calls: [
        { target: ROUTER, selector: "swap(uint256)" },
        { target: TOKEN, selector: "approve(address,uint256)" },
      ],
    });

    await expect(
      run({ ...base(), "skill-dir": wider, "publisher-private-key": PUBLISHER_PK }),
    ).rejects.toThrow(/Capability set widened/);
  }, 120_000);

  it("allows a widened capability set when explicitly opted in", async () => {
    const narrow = await makeSkill({
      name: "act-optin", version: "1.0.0", body: "narrow",
      calls: [{ target: ROUTER, selector: "swap(uint256)" }],
    });
    await run({ ...base(), "skill-dir": narrow, "publisher-private-key": PUBLISHER_PK });

    const wider = await makeSkill({
      name: "act-optin", version: "2.0.0", body: "wider",
      calls: [
        { target: ROUTER, selector: "swap(uint256)" },
        { target: TOKEN, selector: "approve(address,uint256)" },
      ],
    });

    const result = await run({
      ...base(), "skill-dir": wider, "publisher-private-key": PUBLISHER_PK,
      "fail-on-capability-change": "false",
    });

    expect(result.outputs["pin-id"]).toMatch(/^0x[0-9a-f]{64}$/);
  }, 120_000);

  // --- input validation ---

  it.each([
    [{ "skill-dir": "" }, /skill-dir is required/],
    [{ "pin-registry": "0x1234" }, /pin-registry is not an address/],
    [{ "chain-id": "1" }, /chain-id must be 143 or 10143/],
  ])("rejects bad input (%#)", async (override, pattern) => {
    const skill = await makeSkill({
      name: "act-bad", version: "1.0.0", body: "x",
      calls: [{ target: ROUTER, selector: "swap(uint256)" }],
    });

    await expect(
      run({ ...base(), "skill-dir": skill, "dry-run": "true", ...override }),
    ).rejects.toThrow(pattern);
  }, 60_000);

  it("throws ActionFailure so the runner can distinguish a refusal from a crash", async () => {
    await expect(run({ ...base(), "skill-dir": "", "dry-run": "true" })).rejects.toBeInstanceOf(
      ActionFailure,
    );
  }, 60_000);
});
