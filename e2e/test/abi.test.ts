/**
 * Every hand-written ABI fragment, checked against the compiled contract.
 *
 * Four packages keep their own trimmed ABI, and for a long time two of them declared the
 * `Pin` struct with nine fields where Solidity has eleven. Nothing errored. Every component
 * is statically sized, so viem decoded positionally and each field after the second landed
 * one word early: `exists` read `revokedAt`, a live pin decoded as `exists: false`, and
 * `loadPin` returned undefined. `lockstep status` and `lockstep diff` reported "no pin" for
 * pins plainly on chain, and no test noticed, because every test agreed with the same wrong
 * shape the code did.
 *
 * A partial ABI is fine -- a package need not declare functions it never calls -- but a
 * partial *tuple* is not, and neither is a renamed or reordered field. So the rule enforced
 * here is: whatever a package declares must match the artifact exactly. Fragments it omits
 * are its own business.
 *
 * The artifacts come from `forge build`, which the contract-test step runs before this suite
 * in CI. Locally they may be absent; the suite says so rather than passing vacuously.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { pinRegistryAbi as cliRegistryAbi, lockstepGuardAbi as cliGuardAbi } from "@lockstep/cli/abi";
import { pinRegistryAbi as pluginRegistryAbi, lockstepGuardAbi as pluginGuardAbi } from "@lockstep/openclaw-plugin/abi";
import { pinRegistryAbi as watcherRegistryAbi, guardErrorsAbi } from "@lockstep/watcher/abi";
import {
  pinRegistryAbi as appRegistryAbi,
  lockstepGuardAbi as appGuardAbi,
  guardErrorsAbi as appGuardErrorsAbi,
  lockstepLensAbi as appLensAbi,
} from "@lockstep/app/abi";

const ROOT = resolve(import.meta.dirname, "..", "..");
const OUT = join(ROOT, "contracts", "out");

type Fragment = Record<string, unknown>;

function artifactAbi(contract: string): readonly Fragment[] | undefined {
  const file = join(OUT, `${contract}.sol`, `${contract}.json`);
  if (!existsSync(file)) return undefined;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { abi?: readonly Fragment[] };
  return parsed.abi;
}

/**
 * Renders a fragment as a single canonical string.
 *
 * Names are compared inside tuples and ignored outside them, which is not an arbitrary line.
 * A tuple component name becomes a key on the object viem hands back, so renaming or
 * reordering one silently changes what `pin.exists` reads -- the exact failure this file
 * exists for, and one a type-only comparison would miss, since `skillHash` and `versionId`
 * are both `bytes32`. A top-level parameter name affects nothing: encoding is positional.
 * Solidity's generated mapping getters leave those unnamed (`versionPinCount(address,
 * bytes32)`) while the hand-written ABIs name them for readability, and that difference is
 * worth keeping rather than flattening to satisfy a test.
 */
function canonical(fragment: Fragment): string {
  const params = (list: unknown, named: boolean): string => {
    if (!Array.isArray(list)) return "";
    return list
      .map((raw) => {
        const p = raw as Fragment;
        // Components are always named: one level in, names are load-bearing.
        const inner = Array.isArray(p.components) ? `(${params(p.components, true)})` : "";
        const indexed = p.indexed === true ? " indexed" : "";
        const label = named ? ` ${String(p.name ?? "")}` : "";
        return `${String(p.type)}${inner}${indexed}${label}`.trim();
      })
      .join(", ");
  };

  const kind = String(fragment.type);
  const name = String(fragment.name ?? "");
  const inputs = params(fragment.inputs, false);
  if (kind === "function") {
    return `function ${name}(${inputs}) ${String(fragment.stateMutability ?? "")} returns (${params(fragment.outputs, false)})`;
  }
  if (kind === "event") return `event ${name}(${inputs})`;
  if (kind === "error") return `error ${name}(${inputs})`;
  return `${kind} ${name}(${inputs})`;
}

/** Fragments a package can legitimately declare that no single contract owns. */
const NAMED_BY_KIND = (fragment: Fragment): string => `${String(fragment.type)}:${String(fragment.name ?? "")}`;

interface Subject {
  readonly label: string;
  readonly contract: string;
  readonly abi: readonly Fragment[];
}

const subjects: readonly Subject[] = [
  { label: "@lockstep/cli pinRegistryAbi", contract: "PinRegistry", abi: cliRegistryAbi as readonly Fragment[] },
  { label: "@lockstep/cli lockstepGuardAbi", contract: "LockstepGuard", abi: cliGuardAbi as readonly Fragment[] },
  { label: "@lockstep/openclaw-plugin pinRegistryAbi", contract: "PinRegistry", abi: pluginRegistryAbi as readonly Fragment[] },
  { label: "@lockstep/openclaw-plugin lockstepGuardAbi", contract: "LockstepGuard", abi: pluginGuardAbi as readonly Fragment[] },
  { label: "@lockstep/watcher pinRegistryAbi", contract: "PinRegistry", abi: watcherRegistryAbi as readonly Fragment[] },
  { label: "@lockstep/watcher guardErrorsAbi", contract: "LockstepGuard", abi: guardErrorsAbi as readonly Fragment[] },
  { label: "@lockstep/app pinRegistryAbi", contract: "PinRegistry", abi: appRegistryAbi as readonly Fragment[] },
  { label: "@lockstep/app lockstepGuardAbi", contract: "LockstepGuard", abi: appGuardAbi as readonly Fragment[] },
  { label: "@lockstep/app guardErrorsAbi", contract: "LockstepGuard", abi: appGuardErrorsAbi as readonly Fragment[] },
  /*
   * The Lens matters here more than its size suggests.
   *
   * Its two score functions return four and three values respectively, in an order nothing else
   * enforces, and `summaryValue` is a signed `int128` sitting between a `uint64` and a `uint8`.
   * Decoding is positional, so transposing the count and the value would produce plausible
   * numbers rather than an error -- the same class of failure as the nine-field `Pin` struct that
   * this file was written for.
   */
  { label: "@lockstep/app lockstepLensAbi", contract: "LockstepLens", abi: appLensAbi as readonly Fragment[] },
];

describe("hand-written ABIs match the compiled contracts", () => {
  const haveArtifacts = artifactAbi("PinRegistry") !== undefined;

  it("has compiled artifacts to compare against", () => {
    // Guards against the whole suite passing because there was nothing to check. Run
    // `forge build` (or `forge test`) first; CI does this in the contract-test step.
    expect(
      haveArtifacts,
      `no artifacts under ${OUT}. Run \`forge build\` in contracts/ before this suite.`,
    ).toBe(true);
  });

  for (const subject of subjects) {
    describe(subject.label, () => {
      const artifact = artifactAbi(subject.contract);

      it("declares at least one fragment", () => {
        expect(subject.abi.length).toBeGreaterThan(0);
      });

      it("matches every fragment it declares", () => {
        if (artifact === undefined) return;

        const byName = new Map<string, Fragment[]>();
        for (const fragment of artifact) {
          const key = NAMED_BY_KIND(fragment);
          byName.set(key, [...(byName.get(key) ?? []), fragment]);
        }

        const problems: string[] = [];
        for (const declared of subject.abi) {
          if (declared.type === "constructor" || declared.type === "receive") continue;

          const key = NAMED_BY_KIND(declared);
          const candidates = byName.get(key);
          if (candidates === undefined) {
            problems.push(`${key} is declared here but does not exist on ${subject.contract}`);
            continue;
          }

          const mine = canonical(declared);
          // Overloads share a name, so a match against any candidate is a match.
          if (candidates.some((c) => canonical(c) === mine)) continue;

          problems.push(
            [
              `${key} does not match ${subject.contract}:`,
              `  declared: ${mine}`,
              ...candidates.map((c) => `  compiled: ${canonical(c)}`),
            ].join("\n"),
          );
        }

        expect(problems, problems.join("\n\n")).toEqual([]);
      });
    });
  }

  /**
   * The specific shape that broke, stated directly.
   *
   * The loop above would catch it, but a named test makes the regression legible in a failure
   * list and pins the field order rather than merely "matches the artifact".
   */
  it("declares the full Pin struct wherever getPin appears", () => {
    const expected = [
      "publisher", "skillHash", "versionId", "maxValuePerBatch", "requiredBond",
      "capabilityCount", "highRiskCount", "publishedAt", "revokedAt", "exists", "slashed",
    ];

    for (const subject of subjects) {
      const getPin = subject.abi.find((f) => f.type === "function" && f.name === "getPin");
      if (getPin === undefined) continue;

      const outputs = getPin.outputs as readonly Fragment[] | undefined;
      const components = (outputs?.[0]?.components ?? []) as readonly Fragment[];
      const names = components.map((c) => String(c.name));

      expect(names, `${subject.label} getPin tuple`).toEqual(expected);
    }
  });
});
