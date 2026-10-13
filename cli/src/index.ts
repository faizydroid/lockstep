#!/usr/bin/env node
/**
 * Lockstep CLI.
 *
 * Two audiences, deliberately in one binary so they cannot drift apart:
 *
 *   Publishers - `hash`, `publish`
 *   Account holders - `approve`, `status`, `diff`
 *
 * Every command that touches a chain prints exactly what it is about to do and
 * what it computed, because the whole product is an argument about provenance and
 * a tool that asks for blind trust would undercut it.
 */

import { parseArgs } from "node:util";

import { hashSkillDirectory } from "@lockstep/runtime";

import { publishCommand } from "./commands/publish.ts";
import { approveCommand } from "./commands/approve.ts";
import { statusCommand } from "./commands/status.ts";
import { diffCommand } from "./commands/diff.ts";
import { safeErrorMessage } from "./sanitize.ts";

const USAGE = `
lockstep - bind agent transactions to the exact skill version you approved

  lockstep hash <skill-dir>
      Print the canonical hash of a skill directory. Reads nothing but disk.

  lockstep publish <skill-dir> --manifest <file> [--dry-run] [--badge-dir <dir>]
      Publish a pin for a skill's current bytes and lock its bond.
      Writes the pin badge to the current directory, or to --badge-dir; never into <skill-dir>,
      because that would change the hash that was just pinned.
      Requires PUBLISHER_PRIVATE_KEY.

  lockstep approve <skill-dir> [--publisher <address>]... [--pin <pinId>] [--previous <pinId>] [--yes]
      Approve the current version of a skill for your account.
      Prints who published the pin and checks what it allows against the manifest in <skill-dir>, then asks.
      Name the publisher you trust: on Monad's public RPC that is how the pin is found at all, and it is
      what stops someone else's pin for the same public bytes being the one you approve.
      --previous names the pin you approved before, so the output shows only what is new.
      Requires ACCOUNT_PRIVATE_KEY.

  lockstep status [<skill-dir>] [--publisher <address>]... [--pin <pinId>]...
      Show whether the account is guarded, and for the pins you name, whether each is live, approved,
      and still matches the directory. With nothing named it replays the account's logs, which only
      works on a local chain or an archive endpoint.

  lockstep diff <skill-dir> [--publisher <address>]... [--pin <pinId>] [--previous <pinId>]
      Show the pin for the bytes on disk, who published it, and what it allows. Never signs.

  Lookup flags, shared: --publisher is repeatable and comma-separated, --from-block sets where a log
  scan starts on chains that allow one. TRUSTED_PUBLISHERS in the environment is the same list.

Environment
  RPC_URL                 default https://testnet-rpc.monad.xyz
  CHAIN_ID                143 (mainnet) or 10143 (testnet, default)
  PIN_REGISTRY            PinRegistry address
  ACCOUNT_ADDRESS         the account holding funds
  TRUSTED_PUBLISHERS      comma-separated publisher addresses (approve, status, diff)
  PUBLISHER_PRIVATE_KEY   publisher signing key (publish only)
  ACCOUNT_PRIVATE_KEY     account signing key (approve only)
`.trimStart();

/** Flags that say which pin is meant. Shared by `approve` and `diff`. */
const LOOKUP_OPTIONS = {
  publisher: { type: "string", multiple: true },
  pin: { type: "string" },
  previous: { type: "string" },
  "from-block": { type: "string" },
} as const;

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return command === undefined ? 1 : 0;
  }

  switch (command) {
    case "hash": {
      const dir = rest[0];
      if (dir === undefined) {
        process.stderr.write("lockstep hash: a skill directory is required\n");
        return 2;
      }
      const result = await hashSkillDirectory(dir);
      process.stdout.write(`${result.skillHash}\n`);
      process.stderr.write(`scheme ${result.scheme}, ${result.entries.length} files\n`);
      for (const entry of result.entries) {
        const flags = [entry.normalised ? "norm" : "raw", entry.executable ? "exec" : "----"];
        process.stderr.write(`  ${flags.join(" ")}  ${entry.path}\n`);
      }
      return 0;
    }

    case "publish": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          manifest: { type: "string" },
          "dry-run": { type: "boolean", default: false },
          "badge-dir": { type: "string" },
        },
      });
      return publishCommand({
        skillDir: positionals[0],
        manifestPath: values.manifest,
        dryRun: values["dry-run"] === true,
        badgeDir: values["badge-dir"],
      });
    }

    case "approve": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { yes: { type: "boolean", default: false }, ...LOOKUP_OPTIONS },
      });
      return approveCommand({
        skillDir: positionals[0],
        assumeYes: values.yes === true,
        publishers: values.publisher ?? [],
        pin: values.pin,
        previous: values.previous,
        fromBlock: values["from-block"],
      });
    }

    case "status": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          publisher: { type: "string", multiple: true },
          pin: { type: "string", multiple: true },
          "from-block": { type: "string" },
        },
      });
      return statusCommand({
        skillDir: positionals[0],
        publishers: values.publisher ?? [],
        pins: values.pin ?? [],
        fromBlock: values["from-block"],
      });
    }

    case "diff": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: LOOKUP_OPTIONS,
      });
      return diffCommand({
        skillDir: positionals[0],
        publishers: values.publisher ?? [],
        pin: values.pin,
        previous: values.previous,
        fromBlock: values["from-block"],
      });
    }

    default:
      process.stderr.write(`lockstep: unknown command '${command}'\n\n${USAGE}`);
      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    // Print the message, not a stack: these are operator errors far more often
    // than bugs, and a wall of stack frames buries the actionable line. Scrubbed of
    // RPC URLs first, because viem's messages include the URL and the request, and an
    // RPC URL often carries an API key in its path.
    process.stderr.write(`lockstep: ${safeErrorMessage(error)}\n`);
    process.exit(1);
  });
