/**
 * `lockstep approve` - approve the version of a skill currently on disk.
 *
 * Prints who published the pin and what it allows before writing, and refuses when it cannot show both.
 * Approval that does not show what it is granting is a checkbox, not consent.
 *
 * The publisher is part of what is approved. A pin id is derived from the publisher and the bytes, and the
 * bytes of a skill are public before the honest publisher's CI has run, so anyone can pin them first with a
 * wider capability set. This command used to take whichever pin it found first and never printed whose it
 * was. It now takes a publisher you name, prints it, and stops when several live pins exist and you have
 * not said which you trust.
 */

import { createInterface } from "node:readline/promises";

import { chainFor, publicClientFor, resolveEnv, signerFor } from "../env.ts";
import { lockstepGuardAbi } from "../abi.ts";
import { inspect, type LookupFlags } from "./diff.ts";

export interface ApproveOptions extends LookupFlags {
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
  const inspected = await inspect(client, env, skillDir, options);
  if (!inspected.ok) return inspected.exitCode;
  const { pin, change, approval } = inspected.value;

  if (approval === "approved") return 0;

  if (approval === "not-delegated") {
    // An approval is written to the account's own storage by delegated guard code. On a plain account the
    // transaction below would succeed and store nothing, and the guard would go on refusing every call.
    process.stderr.write(
      `\nrefusing: ${env.account} carries no EIP-7702 delegation, so there is nowhere to store an approval.\n` +
        "Delegate the account to a LockstepGuard first.\n",
    );
    return 1;
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
     * `--yes` still bypasses it, because a flag someone typed is a decision they made. It bypasses only
     * the question: every refusal above, including an unnamed publisher and a manifest that does not
     * match the pin, happens before this point and `--yes` cannot reach it.
     */
    const question =
      change === undefined
        ? `\napprove this version from publisher ${pin.publisher}, with the capabilities listed above? [y/N] `
        : change.widened
          ? "\nthis version can do things the baseline could not. approve anyway? [y/N] "
          : "\nthe bytes changed. capabilities are unchanged or narrower. approve this version? [y/N] ";
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
    args: [pin.pinId],
    chain: chainFor(env.chainId),
    account,
  });

  process.stdout.write(`\napproved    ${pin.pinId}\n`);
  process.stdout.write(`publisher   ${pin.publisher}\n`);
  process.stdout.write(`tx          ${hash}\n`);
  const receipt = await client.waitForTransactionReceipt({ hash });
  process.stdout.write(`status      ${receipt.status}\n`);
  return receipt.status === "success" ? 0 : 1;
}
