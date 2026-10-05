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
 *
 * "Widened" means a `(target, selector)` pair the previous pin did not allow, or a higher
 * native-value ceiling, checked against chain state. It used to mean "more capabilities than the
 * previous pin", found by scanning this publisher's `Published` logs from genesis. Both halves of
 * that were wrong: a same-count swap of one capability for another passed, and the scan was the
 * publisher's latest pin of *any* skill. The scan also could not run where this action is meant to
 * run, because Monad's public RPC refuses `eth_getLogs` over more than 100 blocks, so every real
 * publish failed there with an RPC error. Only the dry run and the already-published no-op worked,
 * because both return before the scan.
 */

import { appendFile } from "node:fs/promises";

import {
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad, monadTestnet } from "viem/chains";

import { badgeSnippet, renderBadge, LOCKSTEP_DASHBOARD } from "@lockstep/badge";
import { hashSkillDirectory } from "@lockstep/runtime";

import {
  loadManifest,
  isHighRiskSelector,
  HIGH_RISK_LABELS,
  registryAbi,
  type Capability,
  type Manifest,
} from "./shared.ts";

/**
 * Where a badge links to. Shared with the CLI rather than matched by hand.
 *
 * "Matches the CLI's constant deliberately" is what this comment used to say, which is a promise a
 * comment cannot keep. Both now read the same exported value.
 *
 * Still not configurable: a badge's only claim is that it points at this registry, and letting a
 * workflow input change that removes the claim.
 */
const DASHBOARD_URL = LOCKSTEP_DASHBOARD;

/**
 * Reads a workflow input the way the runner actually publishes it.
 *
 * The runner uppercases the input name, replaces **spaces** with underscores, and prefixes
 * `INPUT_`. It does *not* touch hyphens. So `skill-dir` arrives as `INPUT_SKILL-DIR`, which is not
 * a POSIX-valid variable name and is the reason `actions/runner#2283` exists asking for it to be
 * changed. `@actions/core.getInput` matches that behaviour exactly, and so must this.
 *
 * This function used to replace hyphens with underscores and therefore looked for
 * `INPUT_SKILL_DIR`, which the runner never sets. **Every hyphenated input was unreachable**, so
 * the action failed with "skill-dir is required" on an invocation that passed `skill-dir`.
 *
 * Thirteen tests passed alongside it because `e2e/test/action.test.ts` populated the environment
 * with the same wrong transform. A test that builds its fixture from the code's own assumption
 * cannot discover that the assumption is wrong, and the fixture here claimed to be "the runner's
 * environment simulated". It has been corrected to the runner's real convention, which is what
 * makes it a simulation rather than a mirror.
 *
 * Nothing caught it earlier because `pin-skill.yml` had never run: it triggers on changes under
 * `demo/skills/**` and nothing had changed there since it was written.
 *
 * The underscore form is still accepted as a fallback. Not for compatibility with the runner --
 * it never emits that -- but because local harnesses and `act` sometimes set it, and a shell
 * cannot export a name containing a hyphen at all.
 */
function input(name: string, fallback = ""): string {
  const upper = name.toUpperCase();
  const asRunnerSetsIt = process.env[`INPUT_${upper.replace(/ /g, "_")}`];
  if (asRunnerSetsIt !== undefined) return asRunnerSetsIt;
  return process.env[`INPUT_${upper.replace(/[ -]/g, "_")}`] ?? fallback;
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

  const previousPinRaw = input("previous-pin-id").trim();
  if (previousPinRaw !== "" && !/^0x[0-9a-fA-F]{64}$/.test(previousPinRaw)) {
    fail(`previous-pin-id must be a 32-byte hex pin id, got ${previousPinRaw}`);
  }
  const previousPin = previousPinRaw === "" ? undefined : (previousPinRaw.toLowerCase() as Hex);

  const manifest = await loadManifest(skillDir);
  const hashed = await hashSkillDirectory(skillDir);
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  const highRisk = manifest.capabilities.filter((c) => isHighRiskSelector(c.selector));
  const bond = (await client.readContract({
    address: registryAddress as Address,
    abi: registryAbi,
    functionName: "quoteBond",
    args: [
      BigInt(manifest.capabilities.length),
      BigInt(highRisk.length),
      manifest.maxValuePerBatch > 0n,
    ],
  })) as bigint;

  await setOutput("skill-hash", hashed.skillHash);
  await setOutput("version-id", manifest.versionId);
  await setOutput("bond-required", bond.toString());

  const rows = manifest.capabilities.map(capabilityRow).join("\n");

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

  /*
   * A dry run has no key, so it has no publisher address to look history up by. It can still
   * compare against a pin it is told about, and that is the comparison worth having on a pull
   * request: it puts what a release adds in front of the reviewer before a merge can publish it.
   */
  if (dryRun) {
    if (previousPin === undefined) {
      await summary(comparisonSummary({ kind: "skipped" }));
    } else {
      const widening = await compareWithPin(client, registryAddress as Address, previousPin, manifest);
      await summary(comparisonSummary({ kind: "compared", source: "input", widening }));
      if (failOnChange && isWidened(widening)) failWidened(widening);
    }
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

  /*
   * Always computed, so the run summary says what this release adds even when the check is
   * switched off. Only `fail-on-capability-change` decides whether the answer stops the release.
   */
  const baseline = await findBaseline(
    client,
    registryAddress as Address,
    account.address,
    manifest.name,
    previousPin,
  );
  const comparison: Comparison =
    baseline.kind === "pin"
      ? {
          kind: "compared",
          source: baseline.source,
          widening: await compareWithPin(
            client,
            registryAddress as Address,
            baseline.pinId,
            manifest,
            account.address,
          ),
        }
      : baseline;
  await summary(comparisonSummary(comparison));

  if (failOnChange) {
    // Fails closed. Publishing on "could not check" would make the default setting a promise
    // the action only keeps on RPCs generous enough to answer.
    if (comparison.kind === "unknown") {
      fail(
        `Cannot tell whether this release widens capability: the RPC could not serve this ` +
          `publisher's publish history (${comparison.reason}). Monad's public RPC caps eth_getLogs ` +
          `at 100 blocks, so history from genesis cannot be read there. Set previous-pin-id to the ` +
          `pin this release replaces, or set fail-on-capability-change: false to publish without ` +
          `the check.`,
      );
    }
    if (comparison.kind === "compared" && isWidened(comparison.widening)) {
      failWidened(comparison.widening);
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
    // The registry derives the version id from these two strings, so `manifest.versionId` is not
    // passed. It is still computed locally, for the equivocation pre-flight check above.
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
    chain,
    account,
  });

  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") fail(`publish reverted: ${hash}`);

  await setOutput("pin-id", pinId);

  /*
   * The run summary is where a publisher actually looks after CI, so the badge goes there.
   *
   * This used to be one line with a tick in it. A tick is a receipt; the badge is something a publisher
   * might want, and offering it at the moment their release just succeeded costs nothing and is the only
   * moment they are paying attention to this job.
   *
   * The image path is relative and stays that way. A hosted badge would report every README view to
   * whoever runs the host — which repositories carry a pin, how often they are read — and for a
   * supply-chain security product that is a map of its own users' posture handed to a third party. The
   * cost is that this buys distribution with no measurement at all, which is the right trade and is
   * stated in the README rather than quietly hoped past.
   */
  const snippet = badgeSnippet({ skillName: manifest.name, pinId, dashboard: DASHBOARD_URL });
  const badgeSvg = renderBadge({
    state: bond > 0n ? "bonded" : "pinned",
    bondWholeUnits: Number(bond / 1_000_000n),
    highRiskCount: highRisk.length,
  });

  await summary(
    [
      ``,
      `### Published`,
      ``,
      `| | |`,
      `|---|---|`,
      `| pin | \`${pinId}\` |`,
      `| tx | \`${hash}\` |`,
      `| bond locked | ${formatUnits(bond, 6)} |`,
      ``,
      `#### Badge`,
      ``,
      `Write this file to \`${snippet.fileName}\` and paste the line below into your README.`,
      ``,
      "```markdown",
      snippet.markdown,
      "```",
      ``,
      `<details><summary>The SVG</summary>`,
      ``,
      "```svg",
      badgeSvg,
      "```",
      ``,
      `</details>`,
      ``,
      `The image is a relative path deliberately: the badge cannot phone home, so nobody learns which`,
      `repositories carry a pin. The link is absolute so a reader can check the claim against the live`,
      `registry instead of trusting the colour.`,
    ].join("\n"),
  );

  process.stdout.write(`published ${pinId} in ${hash}\n`);
  process.stdout.write(`badge markdown: ${snippet.markdown}\n`);
}

type Client = ReturnType<typeof createPublicClient>;

/** What a release adds relative to the pin it replaces. */
interface Widening {
  readonly previousPinId: Hex;
  /** Declared `(target, selector)` pairs the previous pin did not allow. */
  readonly added: readonly Capability[];
  /** Present only when the native-value ceiling rises. Lowering it narrows the release. */
  readonly ceiling?: { readonly from: bigint; readonly to: bigint };
}

type Comparison =
  | { readonly kind: "compared"; readonly source: "input" | "history"; readonly widening: Widening }
  | { readonly kind: "first-release"; readonly why: string }
  | { readonly kind: "unknown"; readonly reason: string }
  | { readonly kind: "skipped" };

type Baseline =
  | { readonly kind: "pin"; readonly pinId: Hex; readonly source: "input" | "history" }
  | Extract<Comparison, { readonly kind: "first-release" | "unknown" }>;

function isWidened(widening: Widening): boolean {
  return widening.added.length > 0 || widening.ceiling !== undefined;
}

function failWidened(widening: Widening): never {
  const parts: string[] = [];
  if (widening.added.length > 0) {
    parts.push(`adds ${widening.added.map((c) => `${c.label} on ${c.target}`).join(", ")}`);
  }
  if (widening.ceiling !== undefined) {
    parts.push(
      `raises the native value ceiling from ${formatEther(widening.ceiling.from)} to ` +
        `${formatEther(widening.ceiling.to)} MON per batch`,
    );
  }
  fail(
    `Capability set widened against pin ${widening.previousPinId}: this release ${parts.join(" and ")}. ` +
      `Users must approve it explicitly, and a wider blast radius should be a decision rather than a ` +
      `side effect. Set fail-on-capability-change: false to publish it anyway.`,
  );
}

function capabilityRow(c: Capability): string {
  const risk = isHighRiskSelector(c.selector) ? `⚠️ ${HIGH_RISK_LABELS[c.selector] ?? "elevated"}` : "";
  return `| \`${c.target}\` | \`${c.label}\` | ${risk} |`;
}

function comparisonSummary(comparison: Comparison): string {
  const heading = ["", "### Compared with the previous pin", ""];
  switch (comparison.kind) {
    case "skipped":
      return [
        ...heading,
        "Not compared. Set `previous-pin-id` to the pin this release replaces to see what it adds.",
      ].join("\n");
    case "first-release":
      return [...heading, `Nothing to compare: ${comparison.why}.`].join("\n");
    case "unknown":
      return [...heading, `Not compared: ${comparison.reason}.`].join("\n");
    case "compared": {
      const { widening } = comparison;
      const origin = comparison.source === "input" ? "given as `previous-pin-id`" : "the latest earlier pin of this skill";
      const lines = [...heading, `Previous pin \`${widening.previousPinId}\`, ${origin}.`, ""];
      if (!isWidened(widening)) {
        lines.push(
          "No capability added and no higher native-value ceiling. Users still approve the new pin " +
            "explicitly, because its bytes are new.",
        );
        return lines.join("\n");
      }
      if (widening.added.length > 0) {
        lines.push(
          `#### Added capabilities (${widening.added.length})`,
          "",
          "| target | function | risk |",
          "|---|---|---|",
          ...widening.added.map(capabilityRow),
          "",
        );
      }
      if (widening.ceiling !== undefined) {
        lines.push(
          `Native value per batch rises from ${formatEther(widening.ceiling.from)} to ` +
            `${formatEther(widening.ceiling.to)} MON.`,
        );
      }
      return lines.join("\n");
    }
  }
}

/**
 * What this release adds over `pinId`, read from chain state rather than logs.
 *
 * `isAllowed` is the registry's own capability check, the one the guard enforces, so the
 * comparison cannot disagree with enforcement. A revoked pin keeps its capability set, so a
 * release replacing a revoked one is still compared against what it replaces.
 */
async function compareWithPin(
  client: Client,
  registry: Address,
  pinId: Hex,
  manifest: Manifest,
  publisher?: Address,
): Promise<Widening> {
  const pin = (await client.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "getPin",
    args: [pinId],
  })) as { readonly publisher: Address; readonly maxValuePerBatch: bigint; readonly exists: boolean };

  if (!pin.exists) fail(`previous pin ${pinId} does not exist in registry ${registry}`);
  // A comparison against someone else's pin answers a question nobody asked, and would pass a
  // widening whenever the other publisher's skill happened to be broader.
  if (publisher !== undefined && pin.publisher.toLowerCase() !== publisher.toLowerCase()) {
    fail(`previous pin ${pinId} was published by ${pin.publisher}, not ${publisher}`);
  }

  const added: Capability[] = [];
  for (const capability of manifest.capabilities) {
    const allowed = (await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "isAllowed",
      args: [pinId, capability.target, capability.selector],
    })) as boolean;
    if (!allowed) added.push(capability);
  }

  const raised = manifest.maxValuePerBatch > pin.maxValuePerBatch;
  return {
    previousPinId: pinId,
    added,
    ...(raised ? { ceiling: { from: pin.maxValuePerBatch, to: manifest.maxValuePerBatch } } : {}),
  };
}

/**
 * The pin a release is compared against: given, inferred from bond state, or found in history.
 *
 * Never throws for an RPC that cannot answer. It reports `unknown`, and the caller decides
 * whether that blocks the release.
 */
async function findBaseline(
  client: Client,
  registry: Address,
  publisher: Address,
  name: string,
  explicit: Hex | undefined,
): Promise<Baseline> {
  if (explicit !== undefined) return { kind: "pin", pinId: explicit, source: "input" };

  /*
   * Nothing locked means no live pin, so there is nothing a release could widen.
   *
   * Sound only while every publish locks a nonzero bond, which a nonzero base bond guarantees, and
   * `quoteBond(0, 0, false)` is exactly the base bond. Bond is only ever released by reclaiming a
   * revoked pin or by a slash, which revokes both pins it touches, so zero locked means zero pins
   * in service. Checked first because it is two reads, and a first release is the common case on
   * an RPC that cannot serve the history query below.
   */
  const [floor, locked] = (await Promise.all([
    client.readContract({ address: registry, abi: registryAbi, functionName: "quoteBond", args: [0n, 0n, false] }),
    client.readContract({ address: registry, abi: registryAbi, functionName: "lockedBond", args: [publisher] }),
  ])) as [bigint, bigint];
  if (floor > 0n && locked === 0n) {
    return { kind: "first-release", why: "this publisher has no live pins" };
  }

  /*
   * One query, never a loop. Paging 100-block windows from the registry's deployment would cost
   * tens of thousands of requests against a rate-limited endpoint, which is not a check a CI step
   * can make. An RPC that answers an open range gets an exact lookup; one that refuses gets an
   * honest "unknown" and the instruction to pass `previous-pin-id`.
   */
  try {
    const logs = await client.getContractEvents({
      address: registry,
      abi: registryAbi,
      eventName: "Published",
      args: { publisher },
      fromBlock: "earliest",
    });
    // Same skill only. The latest pin of any skill was the old baseline, which compared a release
    // against whatever this publisher happened to ship last.
    const mine = logs.filter((log) => (log.args as { name?: string }).name === name);
    if (mine.length === 0) {
      return { kind: "first-release", why: `no earlier pin of ${name} by this publisher` };
    }
    const latest = mine.reduce((a, b) => {
      const ab = a.blockNumber ?? 0n;
      const bb = b.blockNumber ?? 0n;
      if (ab !== bb) return ab > bb ? a : b;
      return (a.logIndex ?? 0) >= (b.logIndex ?? 0) ? a : b;
    });
    return { kind: "pin", pinId: (latest.args as { pinId: Hex }).pinId, source: "history" };
  } catch (error) {
    return { kind: "unknown", reason: rpcReason(error) };
  }
}

/**
 * Why an RPC call failed, without the request URL.
 *
 * viem's error messages include the URL, and an RPC URL often carries an API key in its path, so
 * printing the raw error would put that key in a CI log anyone with read access can see. Only the
 * server's own reason is surfaced.
 */
function rpcReason(error: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const details = (current as { details?: unknown }).details;
    if (typeof details === "string" && details !== "") {
      const range = /limited to a \d+ range/i.exec(details);
      if (range !== null) return `eth_getLogs is ${range[0]}`;
      const quoted = /"message"\s*:\s*"([^"]{1,200})"/.exec(details);
      if (quoted?.[1] !== undefined) return quoted[1];
      if (!/https?:\/\//i.test(details)) return details.slice(0, 200);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return "the RPC refused the query";
}
