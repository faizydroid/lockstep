/**
 * Lockstep GitHub Action.
 *
 * Publishing a pin belongs in CI, not on a laptop, for three reasons:
 *
 *   1. The executable bit is not representable on Windows filesystems, so a skill
 *      containing an executable script hashes differently there. CI on Linux is the
 *      only place a pin is reliably reproducible.
 *   2. A pin should describe what was actually released, and a release already runs
 *      here.
 *   3. Distribution is the moat. A mechanism in a publisher's pipeline is far harder
 *      to displace than a contract, because the contract can be copied in a week and
 *      the pipeline integration cannot.
 *
 * The action deliberately does two things a human would forget. It refuses to
 * publish a second conflicting claim about one version, which would be
 * self-slashing. And it fails the job on a widened capability set, so a larger blast
 * radius shows up as a red check rather than a silent release.
 */

import { appendFile } from "node:fs/promises";

import { createPublicClient, createWalletClient, formatUnits, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad, monadTestnet } from "viem/chains";

import { hashSkillDirectory } from "@lockstep/runtime";

import { loadManifest, isHighRiskSelector, HIGH_RISK_LABELS, registryAbi } from "./shared.ts";

function input(name: string, fallback = ""): string {
  return process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`] ?? fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = input(name).trim().toLowerCase();
  if (raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

async function setOutput(name: string, value: string): Promise<void> {
  const file = process.env.GITHUB_OUTPUT;
  if (file === undefined || file === "") {
    process.stdout.write(`${name}=${value}\n`);
    return;
  }
  // Heredoc form, because a value could in principle contain a newline.
  const delimiter = `LOCKSTEP_${Math.random().toString(36).slice(2)}`;
  await appendFile(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function summary(markdown: string): Promise<void> {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file === undefined || file === "") {
    process.stdout.write(`${markdown}\n`);
    return;
  }
  await appendFile(file, `${markdown}\n`);
}

/**
 * A failure the runner should surface as a red check.
 *
 * Thrown rather than `process.exit`ed. An earlier version exited directly, which made
 * `main()` impossible to test: any assertion about a refused publish would have taken
 * the test process down with it. `entry.ts` catches this and does the exiting, which is
 * where that belongs.
 */
export class ActionFailure extends Error {
  override readonly name = "ActionFailure";
}

function fail(message: string): never {
  throw new ActionFailure(message);
}

export async function main(): Promise<void> {
  const skillDir = input("skill-dir");
  if (skillDir === "") fail("skill-dir is required");

  const registryAddress = input("pin-registry");
  if (!isAddress(registryAddress)) fail(`pin-registry is not an address: ${registryAddress}`);

  const chainIdRaw = input("chain-id", "10143");
  if (chainIdRaw !== "143" && chainIdRaw !== "10143") {
    fail(`chain-id must be 143 or 10143, got ${chainIdRaw}`);
  }
  const chain = chainIdRaw === "143" ? monad : monadTestnet;
  const rpcUrl = input("rpc-url", chainIdRaw === "143" ? "https://rpc.monad.xyz" : "https://testnet-rpc.monad.xyz");
  const dryRun = bool("dry-run", false);
  const failOnChange = bool("fail-on-capability-change", true);

  const manifest = await loadManifest(skillDir);
  const hashed = await hashSkillDirectory(skillDir);
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  const highRisk = manifest.capabilities.filter((c) => isHighRiskSelector(c.selector));
  const bond = (await client.readContract({
    address: registryAddress as Address,
    abi: registryAbi,
    functionName: "quoteBond",
    args: [BigInt(manifest.capabilities.length), BigInt(highRisk.length), manifest.maxValuePerCall > 0n],
  })) as bigint;

  await setOutput("skill-hash", hashed.skillHash);
  await setOutput("version-id", manifest.versionId);
  await setOutput("bond-required", bond.toString());

  const rows = manifest.capabilities
    .map((c) => {
      const risk = isHighRiskSelector(c.selector)
        ? `⚠️ ${HIGH_RISK_LABELS[c.selector] ?? "elevated"}`
        : "";
      return `| \`${c.target}\` | \`${c.label}\` | ${risk} |`;
    })
    .join("\n");

  await summary(
    [
      `## Lockstep pin: ${manifest.name} ${manifest.version}`,
      "",
      `| | |`,
      `|---|---|`,
      `| skill hash | \`${hashed.skillHash}\` |`,
      `| version id | \`${manifest.versionId}\` |`,
      `| scheme | \`${hashed.scheme}\` over ${hashed.entries.length} files |`,
      `| bond required | ${formatUnits(bond, 6)} |`,
      "",
      `### Declared capabilities (${manifest.capabilities.length})`,
      "",
      `| target | function | risk |`,
      `|---|---|---|`,
      rows,
    ].join("\n"),
  );

  if (dryRun) {
    process.stdout.write("dry-run: nothing published\n");
    return;
  }

  const key = input("publisher-private-key");
  if (key === "") fail("publisher-private-key is required unless dry-run is true");
  const normalised = (key.startsWith("0x") ? key : `0x${key}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalised)) fail("publisher-private-key must be 32 bytes of hex");

  const account = privateKeyToAccount(normalised);
  process.stdout.write(`publisher ${account.address}\n`);

  // Refuse to help a publisher slash themselves. A second conflicting claim about a
  // version is provable equivocation and anyone can take the bond for it. The
  // overwhelmingly likely cause is a forgotten version bump.
  const existingClaims = (await client.readContract({
    address: registryAddress as Address,
    abi: registryAbi,
    functionName: "versionPinCount",
    args: [account.address, manifest.versionId],
  })) as bigint;

  const pinId = (await client.readContract({
    address: registryAddress as Address,
    abi: registryAbi,
    functionName: "computePinId",
    args: [account.address, hashed.skillHash],
  })) as Hex;

  if (existingClaims > 0n) {
    const live = (await client.readContract({
      address: registryAddress as Address,
      abi: registryAbi,
      functionName: "liveSkillHash",
      args: [pinId],
    })) as Hex;

    if (live === hashed.skillHash) {
      process.stdout.write("already published: these exact bytes are pinned\n");
      await setOutput("pin-id", pinId);
      return;
    }

    fail(
      `Refusing to publish. ${manifest.name} ${manifest.version} already has ${existingClaims} pin(s) ` +
        `and these bytes differ. That is provable equivocation and anyone could take your bond. ` +
        `Bump the version and re-run.`,
    );
  }

  if (failOnChange) {
    const previous = await previousCapabilityCount(client, registryAddress as Address, account.address);
    if (previous !== undefined && manifest.capabilities.length > previous) {
      fail(
        `Capability set widened: ${previous} declared previously, ${manifest.capabilities.length} now. ` +
          `Users must re-approve. Set fail-on-capability-change: false to allow it.`,
      );
    }
  }

  const unlocked = (await client.readContract({
    address: registryAddress as Address,
    abi: registryAbi,
    functionName: "unlockedBond",
    args: [account.address],
  })) as bigint;

  if (unlocked < bond) {
    fail(
      `Insufficient unlocked bond: need ${formatUnits(bond, 6)}, have ${formatUnits(unlocked, 6)}. ` +
        `Deposit more, or narrow the manifest — a narrower manifest is cheaper by design.`,
    );
  }

  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const hash = await wallet.writeContract({
    address: registryAddress as Address,
    abi: registryAbi,
    functionName: "publish",
    args: [
      hashed.skillHash,
      manifest.versionId,
      manifest.maxValuePerCall,
      manifest.capabilities.map((c) => c.target),
      manifest.capabilities.map((c) => c.selector),
    ],
    chain,
    account,
  });

  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") fail(`publish reverted: ${hash}`);

  await setOutput("pin-id", pinId);
  await summary(`\n✅ Published \`${pinId}\` in \`${hash}\``);
  process.stdout.write(`published ${pinId} in ${hash}\n`);
}

/**
 * Capability count of this publisher's most recent pin, if any.
 *
 * Used only to warn about widening. Returns undefined for a first publish, which
 * must not be treated as a widening or every new skill would fail its own release.
 */
async function previousCapabilityCount(
  client: ReturnType<typeof createPublicClient>,
  registry: Address,
  publisher: Address,
): Promise<number | undefined> {
  const logs = await client.getContractEvents({
    address: registry,
    abi: registryAbi,
    eventName: "Published",
    args: { publisher },
    fromBlock: "earliest",
  });
  if (logs.length === 0) return undefined;

  const latest = logs.reduce((a, b) => ((a.blockNumber ?? 0n) >= (b.blockNumber ?? 0n) ? a : b));
  const count = (latest.args as { capabilityCount?: bigint }).capabilityCount;
  return count === undefined ? undefined : Number(count);
}
