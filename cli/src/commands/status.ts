/**
 * `lockstep status` - what the account has approved, and whether disk still matches.
 *
 * The interesting column is the last one. An approval whose skill has since
 * changed on disk is precisely the state where an agent is about to be blocked,
 * and seeing it before that happens is the difference between a diagnosis and a
 * mystery.
 *
 * An account's approvals are not enumerable on chain: they are keys in a mapping, and the only list of
 * them is the account's event history. On a local chain or an archive endpoint that history can be read.
 * On Monad's public RPC it cannot, so there `status` answers a narrower question that the chain can
 * answer: for the skill in this directory and the publishers you name, is each pin live, and has this
 * account approved it. The two modes print what they are.
 */

import { formatUnits, type Hex } from "viem";

import { hashSkillDirectory } from "@lockstep/runtime";

import { publicClientFor, resolveEnv } from "../env.ts";
import { loadManifest, type Manifest } from "../manifest.ts";
import { formatCapability, loadApprovedPinIds, loadPin } from "../pins.ts";
import {
  approvalState,
  checkManifest,
  computePinId,
  delegateOf,
  isLogRangeRefusal,
  parseAddressList,
  parsePinId,
  readPin,
  type PinState,
} from "../lookup.ts";

export interface StatusOptions {
  readonly skillDir: string | undefined;
  /** `--publisher`, repeatable and comma-separated. */
  readonly publishers: readonly string[];
  /** `--pin`, repeatable. */
  readonly pins: readonly string[];
  /** `--from-block`, for chains that allow a log scan. */
  readonly fromBlock: string | undefined;
}

const out = (text: string): void => {
  process.stdout.write(text);
};

export async function statusCommand(options: StatusOptions): Promise<number> {
  const env = resolveEnv();
  const client = publicClientFor(env);

  out(`account     ${env.account}\n`);
  out(`registry    ${env.registry}\n`);
  out(`chain       ${env.chainId}\n`);

  // A plain account has nowhere to store an approval and nothing enforcing one. Saying so first matters
  // more than any list below it: an empty list reads as "safe by default" when it can mean "not guarded".
  const delegate = delegateOf(await client.getCode({ address: env.account }));
  out(
    `delegation  ${
      delegate ?? "NONE. This account carries no EIP-7702 delegation: nothing guards it and it cannot hold approvals."
    }\n\n`,
  );

  const onDisk = options.skillDir === undefined ? undefined : await hashSkillDirectory(options.skillDir);
  let manifest: Manifest | undefined;
  if (options.skillDir !== undefined) {
    try {
      manifest = await loadManifest(options.skillDir);
    } catch {
      manifest = undefined;
    }
  }

  const publishers = [
    ...parseAddressList(options.publishers, "--publisher"),
    ...parseAddressList(process.env.TRUSTED_PUBLISHERS === undefined ? [] : [process.env.TRUSTED_PUBLISHERS], "TRUSTED_PUBLISHERS"),
  ];
  const named = new Set<Hex>(options.pins.map((p) => parsePinId(p, "--pin")));
  if (onDisk !== undefined) for (const publisher of publishers) named.add(computePinId(publisher, onDisk.skillHash));

  let stale = 0;

  if (named.size > 0) {
    // Mode 1: the pins you named. Everything here is an `eth_call`.
    out(`pins asked about (${named.size}). Approvals are not enumerable on chain, so this lists what you named.\n\n`);
    for (const pinId of named) {
      const pin = await readPin(client, env.registry, pinId);
      if (pin === undefined) {
        out(`  ${pinId}\n    no such pin in the registry\n\n`);
        continue;
      }
      const approval = await approvalState(client, env.account, pinId);
      stale += await printNamedPin(client, env.registry, pin, approval, onDisk?.skillHash, manifest);
    }
  } else {
    // Mode 2: the account's own history. Needs a log scan.
    let approvedIds: readonly Hex[];
    try {
      approvedIds = await loadApprovedPinIds(client, env.account, parseFromBlock(options.fromBlock));
    } catch (error) {
      if (!isLogRangeRefusal(error)) throw error;
      process.stderr.write(
        "cannot list approvals: that means scanning this account's logs, and this RPC refuses queries that wide\n" +
          "(Monad's public endpoint allows 100 blocks). Ask about what you care about instead:\n" +
          "  lockstep status <skill-dir> --publisher <address>\n" +
          "  lockstep status --pin <pinId>\n",
      );
      return 1;
    }

    if (approvedIds.length === 0) {
      out(
        "no approved pins.\n" +
          "Until a pin is approved, every guarded call is rejected. That is the correct\n" +
          "default: an account with no approvals cannot be moved by any skill.\n",
      );
      return 0;
    }

    out(`approved pins (${approvedIds.length})\n\n`);
    for (const pinId of approvedIds) {
      const pin = await loadPin(client, env.registry, pinId);
      if (pin === undefined) {
        out(`  ${pinId}\n    pin no longer exists in the registry\n\n`);
        continue;
      }

      out(`  ${pinId}\n`);
      out(`    publisher   ${pin.publisher}\n`);
      out(`    skillHash   ${pin.skillHash}\n`);
      out(`    revoked     ${pin.revoked ? "YES - guard will reject" : "no"}\n`);
      if (pin.maxValuePerBatch > 0n) {
        out(`    value cap   ${formatUnits(pin.maxValuePerBatch, 18)} MON per batch (total, not per call)\n`);
      }
      for (const capability of pin.capabilities) out(`    allows      ${formatCapability(capability)}\n`);

      if (onDisk !== undefined) {
        const matches = onDisk.skillHash === pin.skillHash;
        out(`    on disk     ${matches ? "matches" : `DIFFERS (${onDisk.skillHash})`}\n`);
        if (!matches) stale += 1;
      }
      out("\n");
    }
  }

  if (stale > 0) {
    out(
      `${stale} approval(s) no longer match the directory you passed.\n` +
        "Run `lockstep diff <skill-dir> --publisher <address>` to see what changed before approving.\n",
    );
  }

  return 0;
}

function parseFromBlock(value: string | undefined): bigint | "earliest" {
  if (value === undefined) return "earliest";
  if (!/^[0-9]+$/.test(value)) throw new Error("--from-block must be a block number");
  return BigInt(value);
}

/** Prints one named pin and returns 1 if it is approved but no longer matches the directory. */
async function printNamedPin(
  client: Parameters<typeof checkManifest>[0],
  registry: Parameters<typeof checkManifest>[1],
  pin: PinState,
  approval: Awaited<ReturnType<typeof approvalState>>,
  onDiskHash: Hex | undefined,
  manifest: Manifest | undefined,
): Promise<number> {
  out(`  ${pin.pinId}\n`);
  out(`    publisher   ${pin.publisher}\n`);
  out(`    skillHash   ${pin.skillHash}\n`);
  out(
    `    status      ${pin.slashed ? "SLASHED - guard will reject" : pin.revoked ? "REVOKED - guard will reject" : "live"}\n`,
  );
  out(
    `    approved    ${
      approval === "approved" ? "yes" : approval === "not-approved" ? "no" : "n/a: the account has no delegation"
    }\n`,
  );
  out(`    declares    ${pin.capabilityCount} capabilit${pin.capabilityCount === 1 ? "y" : "ies"}, ${pin.highRiskCount} high risk\n`);
  if (pin.maxValuePerBatch > 0n) {
    out(`    value cap   ${formatUnits(pin.maxValuePerBatch, 18)} MON per batch (total, not per call)\n`);
  }

  let stale = 0;
  if (onDiskHash !== undefined) {
    const matches = onDiskHash.toLowerCase() === pin.skillHash.toLowerCase();
    out(`    on disk     ${matches ? "matches" : `DIFFERS (${onDiskHash})`}\n`);
    if (!matches && approval === "approved") stale = 1;
    if (matches && manifest !== undefined) {
      const check = await checkManifest(client, registry, pin, manifest);
      out(
        `    manifest    ${
          check.matches
            ? "matches the pin exactly"
            : "DOES NOT match the pin: it lists powers the pin lacks, or the pin allows powers it does not list. Run `lockstep diff`."
        }\n`,
      );
    }
  }
  out("\n");
  return stale;
}
