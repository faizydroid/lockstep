/**
 * `lockstep approve` - approve the version of a skill currently on disk.
 *
 * Always prints the capability diff before writing. Approval that does not show
 * what it is granting is a checkbox, not consent.
 */

import { createInterface } from "node:readline/promises";

import { chainFor, publicClientFor, resolveEnv, signerFor } from "../env.ts";
import { lockstepGuardAbi } from "../abi.ts";
import { printDiff, resolveChange } from "./diff.ts";

export interface ApproveOptions {
  readonly skillDir: string | undefined;
  readonly assumeYes: boolean;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function approveCommand(options: ApproveOptions): Promise<number> {
  const { skillDir } = options;
  if (skillDir === undefined) {
    process.stderr.write("lockstep approve: a skill directory is required\n");
    return 2;
  }

  const env = resolveEnv();
  const client = publicClientFor(env);
  const { onDiskHash, candidate, approved } = await resolveChange(client, env, skillDir);

  process.stdout.write(`account     ${env.account}\n`);
  process.stdout.write(`directory   ${skillDir}\n`);
  process.stdout.write(`skillHash   ${onDiskHash}\n\n`);

  if (candidate === undefined) {
    process.stderr.write(
      "no pin exists for these bytes, so there is nothing to approve.\n" +
        "Ask the publisher to run `lockstep publish` for this version.\n",
    );
    return 1;
  }

  if (candidate.revoked) {
    // Refuse outright rather than warn. The publisher has said this release is
    // compromised, and the guard would reject it anyway.
    process.stderr.write(
      "refusing: the publisher revoked this version. Approving it would have no effect,\n" +
        "because the guard treats a revoked pin as having no live hash.\n",
    );
    return 1;
  }

  const widened = printDiff(approved, candidate);

  if (approved?.skillHash === candidate.skillHash) {
    return 0;
  }

  if (!options.assumeYes) {
    // Only prompt when capability widened. A code-only change is the case this
    // product exists to make painless, and prompting for it every release is how
    // permission systems train users to click through.
    if (widened) {
      const ok = await confirm("\napprove these capabilities? [y/N] ");
      if (!ok) {
        process.stdout.write("aborted\n");
        return 1;
      }
    } else {
      process.stdout.write("capabilities unchanged: approving without a prompt\n");
    }
  }

  const { account, wallet } = signerFor(env, "ACCOUNT_PRIVATE_KEY");
  if (account.address.toLowerCase() !== env.account.toLowerCase()) {
    process.stderr.write(
      `ACCOUNT_PRIVATE_KEY derives ${account.address}, which is not ACCOUNT_ADDRESS ${env.account}.\n` +
        "Approvals are stored in the account's own storage, so the key must be the account's.\n",
    );
    return 1;
  }

  // Sent to the account's own address: under EIP-7702 that runs the delegated
  // guard code with msg.sender == address(this), which is what `onlySelf` requires.
  const hash = await wallet.writeContract({
    address: env.account,
    abi: lockstepGuardAbi,
    functionName: "approvePin",
    args: [candidate.pinId],
    chain: chainFor(env.chainId),
    account,
  });

  process.stdout.write(`\napproved    ${candidate.pinId}\n`);
  process.stdout.write(`tx          ${hash}\n`);
  const receipt = await client.waitForTransactionReceipt({ hash });
  process.stdout.write(`status      ${receipt.status}\n`);
  return receipt.status === "success" ? 0 : 1;
}
