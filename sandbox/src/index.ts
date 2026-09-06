/**
 * Draft-manifest generation by observation.
 *
 * Hand-writing a capability manifest means listing every contract and 4-byte
 * selector a skill touches. Nobody does that accurately, and a manifest that is
 * tedious to write gets written too wide "to be safe" — which is precisely the
 * failure the bond pricing exists to punish. So the tightest manifest has to be the
 * easiest one to produce.
 *
 * The approach: run the skill against a forked chain, record every call it actually
 * makes, and emit a manifest covering exactly those. Observation cannot prove a skill
 * will never need more, so the output is explicitly a **draft** for a human to
 * review, not an authority.
 *
 * The recorder is pure and takes traces as input, so it can be tested without a node.
 */

import { getAddress, isAddress, type Address, type Hex } from "viem";

/** One observed call, as a trace would report it. */
export interface ObservedCall {
  readonly to: Address;
  /** Full calldata. The first four bytes are the selector; empty means a bare send. */
  readonly input: Hex;
  readonly value: bigint;
  /** True when the call reverted. Reverted calls still reveal intent. */
  readonly reverted?: boolean;
}

export interface DraftCapability {
  readonly target: Address;
  readonly selector: Hex;
  /** How many times this pair was observed. Low counts deserve a closer look. */
  readonly observations: number;
  /** True if any observation reverted. */
  readonly everReverted: boolean;
}

export interface DraftManifest {
  readonly capabilities: readonly DraftCapability[];
  /**
   * Drafted ceiling on the total native value one guarded batch may move.
   *
   * This is the largest value seen on any **single** observed call, which is not the same quantity
   * the field now means, and the gap is deliberate rather than overlooked.
   *
   * `ObservedCall` carries no transaction boundary, so observation cannot tell whether two
   * value-bearing calls belonged to one batch or to two runs. Summing them would over-state the
   * budget for a skill that never batches, and a ceiling that is too wide grants blast radius
   * silently. Too narrow fails loudly instead — the guard refuses with `BatchValueExceedsCeiling`
   * and the revert reason names both numbers — so the narrow answer is the one a draft should
   * produce. A warning says so whenever more than one observed call carried value.
   */
  readonly maxValuePerBatch: bigint;
  readonly warnings: readonly string[];
}

const SELECTOR_LENGTH = 10; // "0x" + 8 hex chars

/** Extracts the selector, mapping empty or short calldata to the bare-send selector. */
export function selectorOf(input: Hex): Hex {
  if (input.length < SELECTOR_LENGTH) return "0x00000000";
  return input.slice(0, SELECTOR_LENGTH).toLowerCase() as Hex;
}

/**
 * Builds a draft manifest from observed calls.
 *
 * Reverted calls are included deliberately. A skill that tried to call `approve` and
 * failed still intends to call `approve`, and omitting it produces a manifest that
 * breaks the first time the call succeeds. Better to surface it and let a reviewer
 * decide.
 */
export function draftFromObservations(calls: readonly ObservedCall[]): DraftManifest {
  const byKey = new Map<string, { capability: DraftCapability }>();
  const warnings: string[] = [];
  let maxValue = 0n;
  let totalValue = 0n;
  let valueBearingCalls = 0;

  for (const call of calls) {
    if (!isAddress(call.to)) {
      warnings.push(`skipped a call to a malformed address: ${String(call.to)}`);
      continue;
    }
    const target = getAddress(call.to);
    const selector = selectorOf(call.input);
    const key = `${target.toLowerCase()}:${selector}`;

    if (call.value > maxValue) maxValue = call.value;
    if (call.value > 0n) {
      totalValue += call.value;
      valueBearingCalls += 1;
    }

    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, {
        capability: {
          target,
          selector,
          observations: 1,
          everReverted: call.reverted === true,
        },
      });
    } else {
      byKey.set(key, {
        capability: {
          ...existing.capability,
          observations: existing.capability.observations + 1,
          everReverted: existing.capability.everReverted || call.reverted === true,
        },
      });
    }
  }

  const capabilities = [...byKey.values()]
    .map((entry) => entry.capability)
    .sort((a, b) =>
      a.target === b.target ? a.selector.localeCompare(b.selector) : a.target.localeCompare(b.target),
    );

  if (capabilities.length === 0) {
    warnings.push(
      "no on-chain calls observed. Either the run did not exercise the skill's transaction paths, or it needs no on-chain capability at all — in which case it should not be pinned.",
    );
  }

  if (maxValue > 0n) {
    warnings.push(
      `native value observed (max ${maxValue} wei). Any native-value capability carries a flat bond premium, so remove it if the skill does not truly need it.`,
    );
  }

  if (valueBearingCalls > 1) {
    warnings.push(
      `${valueBearingCalls} observed calls carried native value, totalling ${totalValue} wei, ` +
        `and maxValuePerBatch is drafted at ${maxValue} wei — the largest single one. That field is ` +
        `a budget for a whole batch, and observation cannot see transaction boundaries, so it cannot ` +
        `tell whether these calls shared one. Drafted narrow on purpose: too narrow is refused at ` +
        `runtime with both numbers in the revert reason, too wide widens blast radius silently. If ` +
        `this skill sends value in more than one call per transaction, raise it to at most ${totalValue}.`,
    );
  }

  for (const capability of capabilities) {
    if (capability.observations === 1) {
      warnings.push(
        `${capability.target} ${capability.selector} was observed once. A single observation may be incidental; confirm the skill really needs it.`,
      );
    }
    if (capability.everReverted) {
      warnings.push(
        `${capability.target} ${capability.selector} reverted during the run. It is included because a failed attempt still shows intent, but check whether it belongs.`,
      );
    }
  }

  return { capabilities, maxValuePerBatch: maxValue, warnings };
}

/**
 * Renders a draft as a `lockstep.json` document.
 *
 * Selectors are emitted as raw 4-byte hex, because observation recovers a selector
 * and not a signature. The header tells the publisher to replace them with
 * signatures, which matters: `0x095ea7b3` is unreviewable, while
 * `approve(address,uint256)` tells a reader they are granting allowance power.
 */
export function renderManifest(
  name: string,
  version: string,
  draft: DraftManifest,
): string {
  const body = {
    schema: "lockstep/1",
    name,
    version,
    _draft: "Generated by observation. Replace hex selectors with signatures and remove anything the skill does not need.",
    capabilities: {
      onchain: {
        calls: draft.capabilities.map((capability) => ({
          target: capability.target,
          selector: capability.selector,
        })),
        maxValuePerBatch: draft.maxValuePerBatch.toString(),
      },
    },
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}
