#!/usr/bin/env node
/**
 * Rotates every live-deployment value in the repository after a redeploy.
 *
 *   node scripts/rotate-deployment.mjs --dry-run --registry 0x… --guard 0x… …
 *   node scripts/rotate-deployment.mjs --write   --registry 0x… --guard 0x… …
 *
 * ## Why this is a script and not a careful afternoon
 *
 * A redeploy changes eleven distinct values spread across **18 tracked files and 85
 * occurrences** — contracts config, two workflows, the indexer, seven test files, five
 * documents, `.env.example` and the export gate. That was counted, not estimated.
 *
 * Doing it by hand fails in the direction that is hardest to notice. Miss the Lens address in
 * `scripts/check-export.mjs` and the export gate fails loudly, which is fine. Miss the guard
 * address in `indexer/config.yaml` and the indexer silently keys executions to a contract that
 * emits nothing. Miss `NEXT_PUBLIC_DEPLOY_BLOCK` in one of the two workflows and the dashboard
 * builds an export that scans from genesis, gets refused, and falls back to sample data while
 * looking correctly configured — the exact silent-dishonesty failure this project is otherwise
 * careful about.
 *
 * So the rotation is mechanical, and it **verifies itself**: after writing, it rescans and
 * refuses to report success while any old value survives anywhere.
 *
 * ## Two phases, because the values are not all known at once
 *
 * Deploying gives you the addresses. The pin id and skill hash only exist after a publish, and
 * the skill hash depends on the bytes of the demo skill. So every flag is optional and only the
 * values supplied are touched:
 *
 *   phase A, straight after `forge script --broadcast`:
 *     --registry --guard --lens --bond-asset --deploy-block --indexer-start-block
 *   phase B, after publishing the demo pin and running one execution:
 *     --pin-id --skill-hash --drifted-hash --account
 *
 * ## What it deliberately does not touch
 *
 * `action/dist/index.js` and the lockfiles are generated, and rewriting a bundle by string
 * substitution is how you get an artifact that no longer corresponds to its source. Rebuild them.
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * The current live values, and the flag that replaces each.
 *
 * `delegationCode` is derived rather than passed: an EIP-7702 designator is
 * `0xef0100 || implementation`, so supplying it separately would let it disagree with the guard
 * address in the same commit. That disagreement is precisely the bug that makes an unguarded
 * account read as guarded.
 */
const VALUES = [
  { key: "registry", flag: "--registry", old: "0xe784a386591cFcE683fAd2C678C8A3c282a9e17b" },
  { key: "guard", flag: "--guard", old: "0xC41eCe384Ee559A30Ed350Ce26ba563B618A3510" },
  { key: "lens", flag: "--lens", old: "0x3338c4F5c8eEFeACF8e41d6ac47B63c466175664" },
  { key: "bondAsset", flag: "--bond-asset", old: "0xF9D382a5A851dAe325526ec0Aa1a9773221c033A" },
  { key: "account", flag: "--account", old: "0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2" },
  {
    key: "pinId",
    flag: "--pin-id",
    old: "0x0573e8dd6c49cffb9c00dbf3eb224b0ee1abab6bae817b95f07d9a1273736401",
  },
  {
    key: "skillHash",
    flag: "--skill-hash",
    old: "0x233f0359c38d87e332c87aa294aab227d89d2a12ece44b254e65ddb4011681ef",
  },
  {
    key: "driftedHash",
    flag: "--drifted-hash",
    old: "0x1eac5d908cd7ab20417efb5ee1f7a563c82b62d6affd97ab5e86012772783b04",
  },
  { key: "deployBlock", flag: "--deploy-block", old: "59431400" },
  { key: "indexerStartBlock", flag: "--indexer-start-block", old: "59428872" },
];

function arg(flag) {
  const at = process.argv.indexOf(flag);
  return at === -1 ? undefined : process.argv[at + 1];
}

const WRITE = process.argv.includes("--write");
const DRY = process.argv.includes("--dry-run") || !WRITE;

const supplied = [];
for (const v of VALUES) {
  const value = arg(v.flag);
  if (value === undefined) continue;
  if (/^0x/.test(v.old) && !new RegExp(`^0x[0-9a-fA-F]{${v.old.length - 2}}$`).test(value)) {
    console.error(`${v.flag}: expected ${v.old.length - 2} hex chars, got "${value}"`);
    process.exit(2);
  }
  if (!/^0x/.test(v.old) && !/^\d+$/.test(value)) {
    console.error(`${v.flag}: expected a decimal block number, got "${value}"`);
    process.exit(2);
  }
  if (value.toLowerCase() === v.old.toLowerCase()) {
    console.error(`${v.flag}: new value equals the old one. Nothing to rotate.`);
    process.exit(2);
  }
  supplied.push({ ...v, new: value });
}

if (supplied.length === 0) {
  console.error("Nothing supplied. Pass at least one of:");
  for (const v of VALUES) console.error(`  ${v.flag.padEnd(24)} currently ${v.old}`);
  process.exit(2);
}

/*
 * Derived designator pair, added only when the guard rotates.
 *
 * Longest-first ordering matters: the truncated form `0xef0100c41ece` appears in prose and in a
 * test, and is a prefix of the full 23-byte designator. Replacing the short form first would
 * corrupt the long one into a mix of both guards.
 */
const guardChange = supplied.find((v) => v.key === "guard");
const replacements = supplied.map((v) => ({ label: v.key, old: v.old, new: v.new }));
if (guardChange !== undefined) {
  const oldFull = `0xef0100${guardChange.old.slice(2)}`;
  const newFull = `0xef0100${guardChange.new.slice(2)}`;
  replacements.unshift({ label: "delegationCode (full)", old: oldFull, new: newFull });
  replacements.push({
    label: "delegationCode (truncated)",
    old: `0xef0100${guardChange.old.slice(2, 8)}`,
    new: `0xef0100${guardChange.new.slice(2, 8)}`,
  });
}

const files = execSync("git ls-files", { encoding: "utf8", maxBuffer: 1e8 })
  .trim()
  .split("\n")
  .filter((f) => !/^action\/dist\//.test(f) && !/package-lock\.json$/.test(f));

console.log("=".repeat(90));
console.log(`ROTATE DEPLOYMENT  ·  ${DRY ? "DRY RUN (nothing written)" : "WRITING"}`);
console.log("=".repeat(90));
for (const r of replacements) console.log(`  ${r.label.padEnd(28)} ${r.old}\n  ${"".padEnd(28)} -> ${r.new}`);
console.log();

let touchedFiles = 0;
let touchedOccurrences = 0;

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  let updated = text;
  const perFile = [];
  for (const r of replacements) {
    // Case-insensitive because addresses appear checksummed, lowercased, and inside a
    // designator. The replacement always writes the canonical form supplied on the CLI.
    const re = new RegExp(r.old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const n = (updated.match(re) ?? []).length;
    if (n === 0) continue;
    updated = updated.replace(re, r.new);
    perFile.push(`${n}x ${r.label}`);
    touchedOccurrences += n;
  }

  if (perFile.length === 0) continue;
  touchedFiles += 1;
  console.log(`  ${file}`);
  for (const p of perFile) console.log(`      ${p}`);
  if (WRITE) writeFileSync(file, updated, "utf8");
}

console.log(`\n  ${touchedOccurrences} occurrence(s) across ${touchedFiles} file(s).`);

// --- self-verification ---
//
// The point of the script. A rotation that silently missed one file is worse than no rotation,
// because the remaining value looks deliberate.
if (WRITE) {
  console.log("\n" + "-".repeat(90));
  console.log("VERIFYING: rescanning for any surviving old value");
  console.log("-".repeat(90));
  const survivors = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const r of replacements) {
      const re = new RegExp(r.old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const n = (text.match(re) ?? []).length;
      if (n > 0) survivors.push(`${file}: ${n}x ${r.label} (${r.old})`);
    }
  }
  if (survivors.length > 0) {
    console.error("FAILED. Old values survive:");
    for (const s of survivors) console.error("  " + s);
    process.exit(1);
  }
  console.log("  clean: no old value remains in any tracked file.\n");
  console.log("Next, and none of it is optional:");
  console.log("  1. npm run build --workspace @lockstep/action   (dist/ is a committed artifact)");
  console.log("  2. cd contracts && forge test                   (fixtures may embed a value)");
  console.log("  3. npm run test:unit && npm run typecheck");
  console.log("  4. npm run verify:dashboard                     (the Lens tripwire lives here)");
  console.log("  5. Re-sign the EIP-7702 delegation to the NEW guard, or the account keeps");
  console.log("     routing through the old one while every page looks correct.");
} else {
  console.log("\nDry run. Re-run with --write to apply.");
}
