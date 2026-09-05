"use client";

/**
 * A command that falsifies what is on screen.
 *
 * ## Why this exists
 *
 * This dashboard spends its whole length arguing that a claim and a reading are different things, and
 * then asks to be believed. Every number on it arrives over an RPC the reader did not make. That is the
 * product's own thesis pointed the wrong way, and the fix is small: hand over the command that checks it.
 *
 * The onboarding material's version of this was letting someone try the core experience before signing
 * up, and one product's habit of letting you run a gated feature and see the watermark rather than
 * hiding it behind a wall. Same shape, different domain: do not describe the thing, hand it over.
 *
 * ## Why `cast` and not `lockstep`
 *
 * The obvious choice was the project's own CLI, and it is the wrong one for most readers. `lockstep
 * status` and `lockstep diff` both take a **skill directory**, because they compare bytes on a disk
 * against the chain — which is exactly right for a publisher and useless for a visitor who does not have
 * the skill checked out. A `cast call` against the registry needs nothing but Foundry and an RPC, and it
 * reads the same slot the page read.
 *
 * `lockstep hash` is used where a local directory genuinely *is* the subject, on the drift page.
 *
 * ## Why the fixture case matters
 *
 * On a sample build these values are invented, and printing a command that would return something else
 * would be worse than printing nothing — a reader who ran it and got a mismatch would conclude the
 * product is broken rather than that the page was labelled. So `Verify` refuses to render a command
 * unless the snapshot is live, and says why.
 */

import { useState } from "react";

import { useSnapshot } from "./data";
import { Pill } from "./ui";

export function Verify({
  command,
  expect: expected,
  note,
}: {
  /** The exact command, already filled in with real values. */
  command: string;
  /** What it should print, in the reader's own words rather than a raw dump. */
  expect: string;
  /** Optional extra: what it proves, or what it does not. */
  note?: string;
}) {
  const { snapshot } = useSnapshot();
  const [copied, setCopied] = useState(false);

  /*
   * Sample data gets a sentence, not a command.
   *
   * The source banner already says the figures are worked examples, but a copyable command sitting under
   * an invented hash is an invitation to run it and be misled. Refusing is the only honest option.
   */
  if (snapshot.source.kind !== "chain") {
    return (
      <div className="chunk rounded-xl bg-raise px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="attention">not checkable</Pill>
          <p className="text-xs font-semibold text-attention-ink">
            These figures are a worked example, so there is nothing to verify against a chain. Point this
            build at a registry and a command appears here.
          </p>
        </div>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can be refused. The command is on screen and selectable either way.
    }
  };

  return (
    <div className="chunk rounded-xl bg-raise px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="shout text-label text-faint">Check this yourself</p>
        <button
          type="button"
          onClick={() => void copy()}
          className="shout press pop-sm rounded-lg bg-panel px-2.5 py-1 text-label text-muted [--pop:var(--shade)] hover:text-text"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>

      {/*
        `select-all` so a click selects the whole command. A half-copied RPC URL is the most likely way
        this goes wrong, and it fails in a way that looks like the product's fault.
      */}
      <pre className="mt-2 overflow-x-auto text-label leading-relaxed">
        <code className="hash select-all text-text">{command}</code>
      </pre>

      <p className="mt-2 text-label leading-relaxed font-semibold text-muted">
        <span className="text-faint">expect</span> {expected}
      </p>
      {note === undefined ? null : (
        <p className="mt-1 text-label leading-relaxed text-faint">{note}</p>
      )}

      {/*
        Said once, here, rather than in every caller. Foundry is the only prerequisite and a reader who
        does not have it should know that before copying.
      */}
      <p className="mt-2 text-label leading-relaxed text-faint">
        Needs Foundry&rsquo;s <code className="hash">cast</code>. No key, no wallet, no account &mdash; it
        is a public read of the same slot this page read.
      </p>
    </div>
  );
}
