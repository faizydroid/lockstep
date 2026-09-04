import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Locks the decisions that make a "check this yourself" block trustworthy.
 *
 * The whole value of `Verify` is that a reader can falsify the page with it. That property is fragile in
 * three specific ways, and each one has a test here rather than a comment:
 *
 *  - printing a command next to fixture values, which would return a mismatch a reader would blame on
 *    the product rather than on the sample data,
 *  - printing the build's RPC when the page read a reader's override, which checks a different endpoint
 *    from the one that produced the numbers,
 *  - hardcoding an address, which silently rots the moment a deployment moves.
 *
 * These are source assertions. That has a real limit worth stating: they prove the guard is written, not
 * that it fires at runtime, because rendering these pages needs a browser and there is none in this
 * suite. What they do catch is the removal of a guard that was put there deliberately.
 */

const APP = join(import.meta.dirname, "..", "src");

const verify = readFileSync(join(APP, "components", "verify.tsx"), "utf8");
const pins = readFileSync(join(APP, "app", "pins", "page.tsx"), "utf8");
const account = readFileSync(join(APP, "app", "account", "page.tsx"), "utf8");
const drift = readFileSync(join(APP, "app", "drift", "page.tsx"), "utf8");

/** Every page that renders a `Verify`, so a new caller cannot skip these rules unnoticed. */
const CALLERS: readonly (readonly [string, string])[] = [
  ["pins", pins],
  ["account", account],
  ["drift", drift],
];

describe("Verify refuses to mislead on sample data", () => {
  it("checks the snapshot source before rendering a command", () => {
    // The guard, not the styling: a build pointed at nothing must not hand out a command.
    expect(verify).toMatch(/snapshot\.source\.kind\s*!==\s*"chain"/);
  });

  it("returns early from that check rather than falling through to the command", () => {
    const guard = /if \(snapshot\.source\.kind !== "chain"\)[\s\S]*?\n  }/.exec(verify)?.[0] ?? "";
    expect(guard).toMatch(/return \(/);
    // The refusal has to say why, or it reads as a broken component.
    expect(guard).toMatch(/worked example/);
  });

  it("says what is needed to run it, once, in the component rather than in every caller", () => {
    expect(verify).toMatch(/Foundry/);
    // No key and no wallet is the part that decides whether a cautious reader copies it at all.
    expect(verify).toMatch(/No key, no wallet/);
  });
});

describe("Verify commands point where the page actually read", () => {
  for (const [name, source] of CALLERS) {
    it(`${name} builds its RPC from the settings override wherever it reads a chain`, () => {
      /*
       * Scoped to commands that actually take an endpoint.
       *
       * The first version of this asserted the override on every caller and failed on drift, correctly:
       * drift's command is `lockstep hash`, which reads a directory and never touches a chain, so there
       * is no endpoint for it to get wrong. Deriving the requirement from the command text keeps the rule
       * true and makes it apply on its own to any future caller that adds a chain read.
       */
      const readsChain = /command=\{`[^`]*--rpc-url/.test(source);
      if (!readsChain) return;

      // `readConfig()` alone would print the build's endpoint while the page read the reader's.
      expect(source, name).toMatch(/settings\.rpcUrl \?\?/);
    });

    it(`${name} hardcodes no chain address or endpoint in the command`, () => {
      const blocks = source.matchAll(/command=\{`([^`]*)`\}/g);
      let found = 0;
      for (const [, command] of blocks) {
        found += 1;
        // A literal 0x-address or https:// inside the template means it stopped tracking config.
        expect(command, `${name}: ${command}`).not.toMatch(/0x[0-9a-fA-F]{40}/);
        expect(command, `${name}: ${command}`).not.toMatch(/https?:\/\//);
      }
      expect(found, `${name} should render at least one Verify command`).toBeGreaterThan(0);
    });
  }
});

describe("each page verifies its own strongest claim", () => {
  it("pins reads liveSkillHash, which is one comparable line and zero when revoked", () => {
    // getPin returns a struct, which a reader cannot compare by eye. liveSkillHash returns bytes32,
    // and returns zero for a revoked or slashed pin, so the same call also checks the state badge.
    expect(pins).toMatch(/liveSkillHash\(bytes32\)\(bytes32\)/);
    expect(pins).not.toMatch(/command=\{`cast call \$\{registry\} "getPin/);
  });

  it("pins expects zero for a revoked or slashed pin instead of the stored hash", () => {
    expect(pins).toMatch(/state === "revoked"/);
    expect(pins).toMatch(/state === "equivocated"/);
  });

  it("account uses cast code, whose output describes itself", () => {
    // A reader who does not know the expected storage slot can still read `ef0100` + 20 bytes and
    // compare the tail against the guard address on the same screen.
    expect(account).toMatch(/cast code \$\{account\.address\}/);
    expect(account).toMatch(/0xef0100/);
  });

  it("account covers all three delegation states, so the expectation is never wrong", () => {
    const block = /<Verify[\s\S]*?\/>/.exec(account)?.[0] ?? "";
    expect(block).toMatch(/"delegated"/);
    expect(block).toMatch(/"contract"/);
  });

  it("drift uses the local hash command, because drift is a claim about a disk", () => {
    // This is the one place the project's own CLI is right: the subject is bytes on the reader's disk,
    // not a chain slot, so no chain read could confirm it.
    expect(drift).toMatch(/lockstep hash/);
  });

  it("drift uses a placeholder path rather than the publisher's chosen name", () => {
    /*
     * This assertion was inverted. It used to require
     * `lockstep hash "./${skill.skillName}"` -- on the reasoning that quoting the path handled a name
     * with a space in it.
     *
     * Quoting is not the problem. `skillName` comes from a publisher's manifest, and this block renders a
     * copy button, so a name containing a quote and a semicolon made the copied command arbitrary code on
     * the reader's own machine, handed over by the security dashboard. There is no escaping that earns
     * that back, and the name was never the directory. Full assertions live in display-name.test.ts.
     */
    expect(drift).toContain("SKILL_DIR_PLACEHOLDER");
    expect(drift).not.toMatch(/lockstep hash[^`]*\$\{skill\./);
    expect(drift).toMatch(/label chosen by the publisher/);
  });
});
