/**
 * `lockstep diff` - what the pin for the bytes on disk is, who published it, and what it allows.
 *
 * Shared with `approve`, which runs `inspect` and then asks. The two must describe a change in the same
 * words, because the person reading this output is deciding whether to sign it, and a command that
 * summarised differently from the one that signs would be two opinions about one transaction.
 *
 * Nothing here scans logs unless nobody was named (see `lookup.ts`). The pin is found by computing it from
 * a publisher the reader chose, and what it allows is confirmed against the manifest in the directory, pair
 * by pair, with the registry as the judge.
 */

import { formatUnits, type Hex, type PublicClient } from "viem";

import { hashSkillDirectory } from "@lockstep/runtime";

import { publicClientFor, resolveEnv, type Env } from "../env.ts";
import { loadManifest, type Capability, type Manifest } from "../manifest.ts";
import { HIGH_RISK_LABELS, isHighRiskSelector } from "../risk.ts";
import {
  approvalState,
  checkManifest,
  compareWithPrevious,
  parseAddressList,
  parsePinId,
  readPin,
  resolvePin,
  type ApprovalState,
  type Change,
  type ManifestCheck,
  type PinState,
} from "../lookup.ts";
import { safeErrorMessage } from "../sanitize.ts";

/** The flags `diff`, `approve` and `status` share for saying which pin is meant. */
export interface LookupFlags {
  /** `--publisher`, repeatable and comma-separated. */
  readonly publishers: readonly string[];
  /** `--pin` */
  readonly pin: string | undefined;
  /** `--previous`: the pin you approved before this one, as the baseline for "what changed". */
  readonly previous: string | undefined;
  /** `--from-block`: where a log scan starts, on chains that allow one. */
  readonly fromBlock: string | undefined;
}

export interface DiffOptions extends LookupFlags {
  readonly skillDir: string | undefined;
}

export function lookupOptions(flags: LookupFlags): {
  readonly publishers: ReturnType<typeof parseAddressList>;
  readonly pin: Hex | undefined;
  readonly fromBlock: bigint | "earliest";
} {
  // The environment variable is the same list the OpenClaw plugin takes as `trustedPublishers`, so one
  // setting names the publishers whose pins you act on, wherever you act.
  const fromEnv = process.env.TRUSTED_PUBLISHERS === undefined ? [] : [process.env.TRUSTED_PUBLISHERS];
  const publishers = [
    ...parseAddressList(flags.publishers, "--publisher"),
    ...parseAddressList(fromEnv, "TRUSTED_PUBLISHERS"),
  ];
  let fromBlock: bigint | "earliest" = "earliest";
  if (flags.fromBlock !== undefined) {
    if (!/^[0-9]+$/.test(flags.fromBlock)) throw new Error("--from-block must be a block number");
    fromBlock = BigInt(flags.fromBlock);
  }
  return {
    publishers,
    pin: flags.pin === undefined ? undefined : parsePinId(flags.pin, "--pin"),
    fromBlock,
  };
}

const out = (text: string): void => {
  process.stdout.write(text);
};
const refuse = (text: string): void => {
  process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
};

export function describeCapability(c: Capability): string {
  const risk = isHighRiskSelector(c.selector)
    ? `  [HIGH RISK: ${HIGH_RISK_LABELS[c.selector.toLowerCase() as Hex] ?? "elevated"}]`
    : "";
  return `${c.target}  ${c.label}${risk}`;
}

const ceiling = (wei: bigint): string => `${formatUnits(wei, 18)} MON per batch (total, not per call)`;

function printPin(pin: PinState, via: "pin" | "publisher" | "logs"): void {
  const how =
    via === "publisher"
      ? "the publisher you named"
      : via === "pin"
        ? "the pin you named"
        : "the only live pin found by scanning logs";
  out(`publisher   ${pin.publisher}   (${how})\n`);
  out(`pin         ${pin.pinId}\n`);
  out(`published   ${new Date(Number(pin.publishedAt) * 1000).toISOString()}\n`);
  out(`bond        ${pin.requiredBond} (smallest units of the bond asset)\n`);
  out(`declares    ${pin.capabilityCount} capabilit${pin.capabilityCount === 1 ? "y" : "ies"}, ${pin.highRiskCount} high risk\n`);
  out(`ceiling     ${pin.maxValuePerBatch === 0n ? "no native value" : ceiling(pin.maxValuePerBatch)}\n`);
}

function printMismatch(check: ManifestCheck): void {
  refuse("refusing: the pin on chain does not match the manifest in this directory.");
  for (const c of check.notAllowed) refuse(`  the pin does NOT allow what the manifest lists: ${describeCapability(c)}`);
  if (check.unlisted > 0) {
    refuse(
      `  the pin allows ${check.unlisted} more capabilit${check.unlisted === 1 ? "y" : "ies"} than the manifest lists, ` +
        "and the registry cannot say which.",
    );
  }
  if (check.ceiling.manifest !== check.ceiling.pin) {
    refuse(
      `  native value ceiling: manifest ${formatUnits(check.ceiling.manifest, 18)} MON, pin ${formatUnits(check.ceiling.pin, 18)} MON`,
    );
  }
  refuse(
    "The pin is what the guard enforces and the manifest is what you can read. Approving a pin that\n" +
      "allows something you were not shown is approving powers you did not see, so this stops here.",
  );
}

function printChange(previous: PinState, candidate: PinState, change: Change): void {
  out(`\nbaseline    ${previous.pinId}\n`);
  out(`            publisher ${previous.publisher}, skillHash ${previous.skillHash}\n`);
  if (previous.publisher.toLowerCase() !== candidate.publisher.toLowerCase()) {
    out("            NOTE: the baseline is a different publisher's pin. Read the changes as a switch, not an update.\n");
  }
  out("\n");

  if (!change.widened) {
    out(
      "code changed, capabilities did not widen.\n" +
        "Nothing new can be reached. You still approve the new bytes explicitly: a new hash is a new pin.\n\n",
    );
  }
  for (const c of change.added) out(`  + ${describeCapability(c)}\n`);
  if (change.keptCount > 0) out(`    ${change.keptCount} unchanged\n`);
  if (change.removedCount > 0) {
    out(`  - ${change.removedCount} capabilit${change.removedCount === 1 ? "y" : "ies"} the baseline allowed and this does not\n`);
  }
  if (change.ceilingAfter !== change.ceilingBefore) {
    const direction = change.ceilingAfter > change.ceilingBefore ? "+" : "-";
    out(`  ${direction} native value ceiling ${formatUnits(change.ceilingBefore, 18)} -> ${formatUnits(change.ceilingAfter, 18)} MON\n`);
  }
  if (change.widened) out("\nThis version can do things the baseline could not. Read the additions above.\n");
}

export interface Inspected {
  readonly onDiskHash: Hex;
  readonly pin: PinState;
  readonly manifest: Manifest;
  readonly previous: PinState | undefined;
  readonly change: Change | undefined;
  readonly approval: ApprovalState;
}

export type InspectResult =
  | { readonly ok: true; readonly value: Inspected }
  | { readonly ok: false; readonly exitCode: number };

/** Resolve the pin, verify it against the manifest, and print everything a reader needs before signing. */
export async function inspect(
  client: PublicClient,
  env: Env,
  skillDir: string,
  flags: LookupFlags,
): Promise<InspectResult> {
  const options = lookupOptions(flags);
  const hashed = await hashSkillDirectory(skillDir);

  out(`account     ${env.account}\n`);
  out(`directory   ${skillDir}\n`);
  out(`skillHash   ${hashed.skillHash}\n\n`);

  let manifest: Manifest;
  try {
    manifest = await loadManifest(skillDir);
  } catch (error) {
    refuse(
      `refusing: cannot read the capability manifest, so there is nothing to check the pin against.\n  ${safeErrorMessage(error)}`,
    );
    return { ok: false, exitCode: 1 };
  }

  const resolution = await resolvePin(client, env.registry, hashed.skillHash, options);
  switch (resolution.kind) {
    case "needs-publisher":
      refuse(
        "cannot find the pin without naming a publisher: looking for one means scanning the registry's logs,\n" +
          "and this RPC refuses queries that wide (Monad's public endpoint allows 100 blocks).\n" +
          "Say whose pin you mean, which is also the safer thing to do:\n" +
          "  lockstep approve <skill-dir> --publisher <address>\n" +
          "or set TRUSTED_PUBLISHERS, or pass --pin <pinId>.",
      );
      return { ok: false, exitCode: 1 };
    case "none":
      refuse(
        `no pin exists for these bytes (searched ${resolution.searched}), so there is nothing to approve.\n` +
          "Ask the publisher to run `lockstep publish` for this version. If you expected one, check the\n" +
          "publisher address you gave.",
      );
      return { ok: false, exitCode: 1 };
    case "unusable":
      for (const p of resolution.pins) {
        refuse(`pin ${p.pinId} (publisher ${p.publisher}) is ${p.slashed ? "SLASHED" : "revoked"}.`);
      }
      refuse(
        "refusing: the publisher withdrew this version. Approving it would have no effect, because the guard\n" +
          "treats a revoked pin as having no live hash.",
      );
      return { ok: false, exitCode: 1 };
    case "ambiguous":
      refuse("more than one publisher has a live pin for these exact bytes:");
      for (const p of resolution.pins) {
        refuse(`  publisher ${p.publisher}\n    pin ${p.pinId}\n    declares ${p.capabilityCount} capabilities, bond ${p.requiredBond}`);
      }
      refuse(
        "Anyone can pin bytes that are public, so which of these is the one you trust is your decision, not\n" +
          "the registry's. Say which: --publisher <address> or --pin <pinId>.",
      );
      return { ok: false, exitCode: 1 };
    case "mismatch":
      refuse(
        `refusing: pin ${resolution.pin.pinId} commits to ${resolution.pin.skillHash},\n` +
          `but this directory hashes to ${hashed.skillHash}. It is a pin for different bytes.`,
      );
      return { ok: false, exitCode: 1 };
    case "found":
      break;
  }
  const { pin, via } = resolution;

  printPin(pin, via);

  const check = await checkManifest(client, env.registry, pin, manifest);
  if (!check.matches) {
    out("\n");
    printMismatch(check);
    return { ok: false, exitCode: 1 };
  }
  out(`\ncapabilities, from the manifest in this directory, each confirmed against the pin (${check.allowed.length})\n`);
  for (const c of check.allowed) out(`    ${describeCapability(c)}\n`);

  let previous: PinState | undefined;
  let change: Change | undefined;
  if (flags.previous !== undefined) {
    const previousId = parsePinId(flags.previous, "--previous");
    if (previousId === pin.pinId) {
      out("\nbaseline    --previous is this pin; nothing to compare it with\n");
    } else {
      previous = await readPin(client, env.registry, previousId);
      if (previous === undefined) {
        refuse(`refusing: --previous ${previousId} is not a pin in this registry.`);
        return { ok: false, exitCode: 1 };
      }
      change = await compareWithPrevious(client, env.registry, previous, pin, manifest);
      printChange(previous, pin, change);
    }
  } else {
    out(
      "\nno baseline: this shows everything the version can do, not what changed. To see only what is new,\n" +
        "pass --previous <pinId> with the pin you approved before.\n",
    );
  }

  const approval = await approvalState(client, env.account, pin.pinId);
  out(
    `\napproval    ${
      approval === "approved"
        ? "already approved by this account"
        : approval === "not-approved"
          ? "not approved by this account"
          : "this account carries no EIP-7702 delegation, so it cannot hold an approval"
    }\n`,
  );

  return { ok: true, value: { onDiskHash: hashed.skillHash, pin, manifest, previous, change, approval } };
}

export async function diffCommand(options: DiffOptions): Promise<number> {
  const { skillDir } = options;
  if (skillDir === undefined) {
    refuse("lockstep diff: a skill directory is required");
    return 2;
  }
  const env = resolveEnv();
  const client = publicClientFor(env);
  const result = await inspect(client, env, skillDir, options);
  return result.ok ? 0 : result.exitCode;
}
