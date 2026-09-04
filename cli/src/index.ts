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

const USAGE = `
lockstep - bind agent transactions to the exact skill version you approved

  lockstep hash <skill-dir>
      Print the canonical hash of a skill directory. Reads nothing but disk.

  lockstep publish <skill-dir> --manifest <file> [--dry-run]
      Publish a pin for a skill's current bytes and lock its bond.
      Requires PUBLISHER_PRIVATE_KEY.

  lockstep approve <skill-dir> [--yes]
      Approve the current version of a skill for your account.
      Shows the capability diff against your existing approval first.
      Requires ACCOUNT_PRIVATE_KEY.

  lockstep status [<skill-dir>]
      Show your approvals, and whether each skill on disk still matches.

  lockstep diff <skill-dir>
      Show what changed between your approved version and what is on disk.

Environment
  RPC_URL                 default https://testnet-rpc.monad.xyz
  CHAIN_ID                143 (mainnet) or 10143 (testnet, default)
  PIN_REGISTRY            PinRegistry address
  ACCOUNT_ADDRESS         the account holding funds
  PUBLISHER_PRIVATE_KEY   publisher signing key (publish only)
  ACCOUNT_PRIVATE_KEY     account signing key (approve only)
`.trimStart();

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
        },
      });
      return publishCommand({
        skillDir: positionals[0],
        manifestPath: values.manifest,
        dryRun: values["dry-run"] === true,
      });
    }

    case "approve": {
      const { positionals, values } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { yes: { type: "boolean", default: false } },
      });
      return approveCommand({ skillDir: positionals[0], assumeYes: values.yes === true });
    }

    case "status":
      return statusCommand({ skillDir: rest[0] });

    case "diff":
      return diffCommand({ skillDir: rest[0] });

    default:
      process.stderr.write(`lockstep: unknown command '${command}'\n\n${USAGE}`);
      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    // Print the message, not a stack: these are operator errors far more often
    // than bugs, and a wall of stack frames buries the actionable line.
    process.stderr.write(`lockstep: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
