/**
 * `lockstep publish` - pin a skill's current bytes and lock its bond.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { formatUnits } from "viem";

import { badgeSnippet, renderBadge, LOCKSTEP_DASHBOARD } from "@lockstep/badge";
import { hashSkillDirectory } from "@lockstep/runtime";

import { pinRegistryAbi } from "../abi.ts";
import { publicClientFor, resolveEnv, signerFor, chainFor } from "../env.ts";
import { loadManifest } from "../manifest.ts";
import { HIGH_RISK_LABELS, isHighRiskSelector } from "../risk.ts";

/**
 * Where a badge links to.
 *
 * Imported rather than declared. This used to be a local constant, and so did the Action's, and so did
 * the dashboard's own badge preview — three copies of a string that gets pasted into other people's
 * READMEs, where a drifted copy is already published somewhere nobody can edit.
 *
 * Still a constant rather than configuration, for the reason it always was: a badge's only claim is
 * that it describes a pin in this registry, and a settable link is a badge that can point elsewhere
 * while looking identical.
 */
const DASHBOARD_URL = LOCKSTEP_DASHBOARD;

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
    args: [
      BigInt(manifest.capabilities.length),
      BigInt(highRisk.length),
      manifest.maxValuePerBatch > 0n,
    ],
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
  if (manifest.maxValuePerBatch > 0n) {
    process.stdout.write(
      `\nnative value ceiling  ${formatUnits(manifest.maxValuePerBatch, 18)} MON per batch\n` +
        `                      a batch is one guarded transaction, of at most 32 calls, and this is\n` +
        `                      the total across them -- not a limit on each one.\n`,
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
    // One struct, and `versionId` is deliberately not in it.
    //
    // The registry derives the version id from `name` and `version` now. It used to accept one and
    // never check it, which meant an honest publisher's CLI computed it correctly while a hostile
    // one could pass `keccak256(<anything>)` and republish different bytes under a version id no
    // challenger could match — defeating the only slashing condition in the system for the price of
    // one `cast send`. The strings go in and the id comes out.
    args: [
      {
        name: manifest.name,
        version: manifest.version,
        skillHash: hashed.skillHash,
        maxValuePerBatch: manifest.maxValuePerBatch,
        targets: manifest.capabilities.map((c) => c.target),
        selectors: manifest.capabilities.map((c) => c.selector),
      },
    ],
    chain: chainFor(env.chainId),
    account,
  });

  process.stdout.write(`\npublished    ${hash}\n`);
  const receipt = await client.waitForTransactionReceipt({ hash });
  process.stdout.write(`status       ${receipt.status}\n`);

  if (receipt.status !== "success") return 1;

  /*
   * The pin id comes from the registry, not from a local keccak.
   *
   * It is `keccak256(abi.encode(publisher, skillHash))` and reimplementing that here would work until
   * it did not. This repo already has a test suite whose whole purpose is catching hand-written copies
   * of on-chain shapes drifting from the contract, so paying one `eth_call` to ask the authority is the
   * consistent choice. `computePinId` is `pure`, so it costs nothing but a round trip.
   */
  const pinId = (await client.readContract({
    address: env.registry,
    abi: pinRegistryAbi,
    functionName: "computePinId",
    args: [account.address, hashed.skillHash],
  })) as `0x${string}`;

  await writeBadge({
    skillDir,
    skillName: manifest.name,
    pinId,
    publisher: account.address,
    bond: quote,
    highRiskCount: highRisk.length,
  });

  return 0;
}

/**
 * Writes the badge and prints the snippet, at the moment the publisher has just succeeded.
 *
 * This is the only point in the whole flow where someone has done the costly, reputationally positive
 * thing and is waiting on a terminal to tell them it worked. It used to print a transaction hash and
 * stop. A hash is a receipt; the badge is something they might actually want, and the moment to offer
 * it is now rather than in a documentation page they will not open.
 *
 * ## Why a file and not a URL
 *
 * The badge is written into the skill directory and referenced by a relative path. A hosted badge would
 * report every README view to whoever runs the host — which repositories carry a pin, how often they
 * are read, from where — and for a supply-chain security product that is a map of its own users'
 * posture handed to a third party. So there is no badge host and there will not be one.
 *
 * The cost of that choice, stated because it is real: **distribution with no measurement.** Nobody can
 * count badge impressions or attribute a visit to one. The only signals available are GitHub code
 * search for the filename and referrer-less traffic to the dashboard. That is the price of the badge
 * not being a tracker, and it is the right trade for this product.
 *
 * ## Why it is not `git add`ed
 *
 * Writing a file into someone's working tree is already at the edge of what a publish command should
 * do. Staging or committing it would be further, and a CLI that touches git during a publish is a CLI
 * people stop trusting with credentials.
 */
async function writeBadge(options: {
  readonly skillDir: string;
  readonly skillName: string;
  readonly pinId: `0x${string}`;
  readonly publisher: `0x${string}`;
  readonly bond: bigint;
  readonly highRiskCount: number;
}): Promise<void> {
  const snippet = badgeSnippet({
    skillName: options.skillName,
    pinId: options.pinId,
    dashboard: DASHBOARD_URL,
  });

  /*
   * Bond above zero and no high-risk capability is the only green state.
   *
   * Amber for a bonded pin that can still call something like `approve` is the badge's whole point: the
   * publisher is accountable and the power is real, and collapsing those into one colour would make the
   * green meaningless. `renderBadge` decides this; the CLI only supplies the facts.
   */
  const svg = renderBadge({
    state: options.bond > 0n ? "bonded" : "pinned",
    bondWholeUnits: Number(options.bond / 1_000_000n),
    highRiskCount: options.highRiskCount,
  });

  const target = join(options.skillDir, snippet.fileName);
  const pinId = options.pinId;

  try {
    await writeFile(target, svg, "utf8");
  } catch (error) {
    // A publish that succeeded on chain must not report failure because a file could not be written.
    // The pin is real either way; the badge is a convenience.
    const why = error instanceof Error ? error.message : String(error);
    process.stdout.write(`\npin published. could not write the badge (${why}), which changes nothing on chain.\n`);
    return;
  }

  process.stdout.write(
    `\npinId        ${pinId}\n` +
      `badge        ${target}\n\n` +
      /*
       * The pointer back to the dashboard.
       *
       * Without this line a publisher who ran the command opened the dashboard, saw a demo account, and
       * concluded nothing had happened. The dashboard cannot guess which address to read, and the
       * quickstart's back half is unreachable until it is told.
       */
      `See it: ${DASHBOARD_URL}/pins?pin=${pinId}\n` +
      `Your account is ${options.publisher} -- paste that into the dashboard's quickstart, or connect\n` +
      `the same wallet, and its approvals and enforcement status resolve from chain state.\n\n` +
      `Paste into your README:\n\n` +
      `  ${snippet.markdown}\n\n` +
      `The image is a relative path on purpose -- the badge cannot phone home, so nobody learns which\n` +
      `repositories carry a pin. The link is absolute so a reader can check the claim against the live\n` +
      `registry rather than trusting the colour. A badge nobody can verify is decoration.\n` +
      `Commit the SVG alongside your README; it is a snapshot of this pin, and the link is the truth.\n`,
  );
}

