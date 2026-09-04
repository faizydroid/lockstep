/**
 * `lockstep publish` - pin a skill's current bytes and lock its bond.
 */

import { formatUnits } from "viem";

import { hashSkillDirectory } from "@lockstep/runtime";

import { pinRegistryAbi } from "../abi.ts";
import { publicClientFor, resolveEnv, signerFor, chainFor } from "../env.ts";
import { loadManifest } from "../manifest.ts";
import { HIGH_RISK_LABELS, isHighRiskSelector } from "../risk.ts";

export interface PublishOptions {
  readonly skillDir: string | undefined;
  readonly manifestPath: string | undefined;
  readonly dryRun: boolean;
}

export async function publishCommand(options: PublishOptions): Promise<number> {
  const { skillDir } = options;
  if (skillDir === undefined) {
    process.stderr.write("lockstep publish: a skill directory is required\n");
    return 2;
  }

  const env = resolveEnv();
  const manifest = await loadManifest(skillDir, options.manifestPath);
  const hashed = await hashSkillDirectory(skillDir);
  const client = publicClientFor(env);

  const highRisk = manifest.capabilities.filter((c) => isHighRiskSelector(c.selector));
  const quote = (await client.readContract({
    address: env.registry,
    abi: pinRegistryAbi,
    functionName: "quoteBond",
    args: [BigInt(manifest.capabilities.length), BigInt(highRisk.length), manifest.maxValuePerCall > 0n],
  })) as bigint;

  process.stdout.write(`skill        ${manifest.name} ${manifest.version}\n`);
  process.stdout.write(`directory    ${skillDir}\n`);
  process.stdout.write(`skillHash    ${hashed.skillHash}\n`);
  process.stdout.write(`versionId    ${manifest.versionId}\n`);
  process.stdout.write(`scheme       ${hashed.scheme} over ${hashed.entries.length} files\n`);
  process.stdout.write(`\ncapabilities (${manifest.capabilities.length})\n`);
  for (const capability of manifest.capabilities) {
    const risk = isHighRiskSelector(capability.selector)
      ? `  <-- HIGH RISK: ${HIGH_RISK_LABELS[capability.selector] ?? "token or authority movement"}`
      : "";
    process.stdout.write(`  ${capability.target}  ${capability.label}${risk}\n`);
  }
  if (manifest.maxValuePerCall > 0n) {
    process.stdout.write(
      `\nnative value ceiling  ${formatUnits(manifest.maxValuePerCall, 18)} MON per call\n`,
    );
  }
  // Bond is denominated in the registry's bond asset, which is AUSD (6 decimals)
  // in production. Printed in whole units so a publisher can sanity-check the
  // magnitude rather than squinting at raw integers.
  process.stdout.write(`\nbond required  ${formatUnits(quote, 6)}\n`);
  if (highRisk.length > 0) {
    process.stdout.write(
      `  includes a premium for ${highRisk.length} high-risk capability(ies).\n` +
        `  Narrowing the manifest is the cheapest way to reduce this.\n`,
    );
  }

  if (options.dryRun) {
    process.stdout.write("\ndry run: nothing was published\n");
    return 0;
  }

  const { account, wallet } = signerFor(env, "PUBLISHER_PRIVATE_KEY");
  process.stdout.write(`\npublisher    ${account.address}\n`);

  // Refuse to help a publisher slash themselves.
  //
  // Publishing a second pin for a version already claimed is, by construction,
  // provable equivocation: two signed statements that one version is two different
  // byte sets. Anyone can then take the bond. The overwhelmingly likely cause is
  // forgetting to bump the version after a code change, so this is a mistake worth
  // blocking loudly rather than a decision to confirm.
  const existingClaims = (await client.readContract({
    address: env.registry,
    abi: pinRegistryAbi,
    functionName: "versionPinCount",
    args: [account.address, manifest.versionId],
  })) as bigint;

  if (existingClaims > 0n) {
    const pinned = (await client.readContract({
      address: env.registry,
      abi: pinRegistryAbi,
      functionName: "liveSkillHash",
      args: [
        (await client.readContract({
          address: env.registry,
          abi: pinRegistryAbi,
          functionName: "computePinId",
          args: [account.address, hashed.skillHash],
        })) as `0x${string}`,
      ],
    })) as `0x${string}`;

    if (pinned === hashed.skillHash) {
      process.stdout.write(
        `\nalready published: these exact bytes are pinned for ${manifest.name} ${manifest.version}.\n`,
      );
      return 0;
    }

    process.stderr.write(
      `\nREFUSING TO PUBLISH.\n\n` +
        `You have already published ${existingClaims} pin(s) for ${manifest.name} ${manifest.version},\n` +
        `and these bytes are different. Publishing would be provable equivocation:\n` +
        `two signed claims that one version is two different byte sets.\n\n` +
        `Anyone could then call slashEquivocation and take your bond.\n\n` +
        `Bump the version in ${manifest.name}'s manifest and publish again.\n`,
    );
    return 1;
  }

  const unlocked = (await client.readContract({
    address: env.registry,
    abi: pinRegistryAbi,
    functionName: "unlockedBond",
    args: [account.address],
  })) as bigint;

  if (unlocked < quote) {
    process.stderr.write(
      `\ninsufficient unlocked bond: need ${formatUnits(quote, 6)}, have ${formatUnits(unlocked, 6)}.\n` +
        `Deposit more with the bond asset's approve + PinRegistry.deposit, or narrow the manifest.\n`,
    );
    return 1;
  }

  const hash = await wallet.writeContract({
    address: env.registry,
    abi: pinRegistryAbi,
    functionName: "publish",
    args: [
      hashed.skillHash,
      manifest.versionId,
      manifest.maxValuePerCall,
      manifest.capabilities.map((c) => c.target),
      manifest.capabilities.map((c) => c.selector),
    ],
    chain: chainFor(env.chainId),
    account,
  });

  process.stdout.write(`\npublished    ${hash}\n`);
  const receipt = await client.waitForTransactionReceipt({ hash });
  process.stdout.write(`status       ${receipt.status}\n`);
  return receipt.status === "success" ? 0 : 1;
}

