/**
 * `lockstep status` - what the account has approved, and whether disk still matches.
 *
 * The interesting column is the last one. An approval whose skill has since
 * changed on disk is precisely the state where an agent is about to be blocked,
 * and seeing it before that happens is the difference between a diagnosis and a
 * mystery.
 */

import { formatUnits } from "viem";

import { hashSkillDirectory } from "@lockstep/runtime";

import { publicClientFor, resolveEnv } from "../env.ts";
import { formatCapability, loadApprovedPinIds, loadPin } from "../pins.ts";

export interface StatusOptions {
  readonly skillDir: string | undefined;
}

export async function statusCommand(options: StatusOptions): Promise<number> {
  const env = resolveEnv();
  const client = publicClientFor(env);

  process.stdout.write(`account     ${env.account}\n`);
  process.stdout.write(`registry    ${env.registry}\n`);
  process.stdout.write(`chain       ${env.chainId}\n\n`);

  const onDisk =
    options.skillDir === undefined ? undefined : await hashSkillDirectory(options.skillDir);

  const approvedIds = await loadApprovedPinIds(client, env.account);
  if (approvedIds.length === 0) {
    process.stdout.write(
      "no approved pins.\n" +
        "Until a pin is approved, every guarded call is rejected. That is the correct\n" +
        "default: an account with no approvals cannot be moved by any skill.\n",
    );
    return 0;
  }

  process.stdout.write(`approved pins (${approvedIds.length})\n\n`);

  let stale = 0;
  for (const pinId of approvedIds) {
    const pin = await loadPin(client, env.registry, pinId);
    if (pin === undefined) {
      process.stdout.write(`  ${pinId}\n    pin no longer exists in the registry\n\n`);
      continue;
    }

    process.stdout.write(`  ${pinId}\n`);
    process.stdout.write(`    publisher   ${pin.publisher}\n`);
    process.stdout.write(`    skillHash   ${pin.skillHash}\n`);
    process.stdout.write(`    revoked     ${pin.revoked ? "YES - guard will reject" : "no"}\n`);
    if (pin.maxValuePerBatch > 0n) {
      process.stdout.write(
        `    value cap   ${formatUnits(pin.maxValuePerBatch, 18)} MON per batch (total, not per call)\n`,
      );
    }
    for (const capability of pin.capabilities) {
      process.stdout.write(`    allows      ${formatCapability(capability)}\n`);
    }

    if (onDisk !== undefined) {
      const matches = onDisk.skillHash === pin.skillHash;
      process.stdout.write(
        `    on disk     ${matches ? "matches" : `DIFFERS (${onDisk.skillHash})`}\n`,
      );
      if (!matches) stale += 1;
    }
    process.stdout.write("\n");
  }

  if (stale > 0) {
    process.stdout.write(
      `${stale} approval(s) no longer match the directory you passed.\n` +
        "Run `lockstep diff <skill-dir>` to see what changed before approving.\n",
    );
  }

  return 0;
}
