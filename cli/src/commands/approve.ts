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
    /*
     * Every hash change prompts. The capability diff changes the wording, never whether you are
     * asked.
     *
     * This used to skip the prompt entirely when capabilities were unchanged, on the reasoning that
     * a code-only rebuild is the case this product exists to make painless. That reasoning
     * contradicted the product's own thesis. The headline is that a software update must not
     * silently inherit financial authority, and the update that inherits it most quietly is exactly
     * the one whose declared capabilities are identical — a publisher who rewrites the bytes and
     * touches nothing in the manifest. Skipping the prompt there made the one case the whole system
     * exists to catch the one case nobody was asked about.
     *
     * What the diff still buys is real and is kept: a widening change says so, names what was
     * gained, and warrants a slower read. A narrowing or capability-identical change is a cheaper
     * decision, not an automatic one. The chain was never the problem here — new bytes are a new
     * hash and therefore a new pin, which is unapproved until this transaction lands. The gap was
     * that this command sent that transaction without asking.
     *
     * `--yes` still bypasses it, because a flag someone typed is a decision they made.
     */
    const question = widened
      ? "\nthis version can do things the approved one could not. approve anyway? [y/N] "
      : "\nthe bytes changed. capabilities are unchanged. approve this version? [y/N] ";
    const ok = await confirm(question);
    if (!ok) {
      process.stdout.write("aborted\n");
      return 1;
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
