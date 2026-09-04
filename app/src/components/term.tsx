"use client";

/**
 * A coinage that explains itself where it is used.
 *
 * ## The problem
 *
 * This product invented most of its own vocabulary. Pin, drift, equivocation, live hash, delegation
 * indicator — none of these mean here what a reader would guess, and several of them mean something
 * precise enough that guessing wrong changes what the page appears to say. Someone who reads "the
 * publisher equivocated" as "the publisher was vague" has just misread a slashing condition as a tone
 * complaint.
 *
 * The existing answer was a native `title` attribute. That is invisible on touch, invisible to keyboard
 * users, and never announced by a screen reader when it sits on a `span`. So the definitions were
 * written but only reachable with a mouse.
 *
 * ## Why not a glossary page
 *
 * A glossary is a place a reader has to leave for, and the moment they need the word is the moment they
 * are mid-sentence somewhere else. This is the same reasoning as putting the verify command next to the
 * claim rather than in docs: bring the thing to where it is needed.
 *
 * ## Three ways in, because there are three kinds of reader
 *
 * Hover for a mouse, focus for a keyboard, tap for a touch screen. The tap case is the one a CSS-only
 * tooltip gets wrong: on touch, `pointerenter` fires as part of the tap and then never leaves, so the
 * panel opens and sticks. Hover is therefore gated on `pointerType === "mouse"` and touch goes through
 * the click toggle, which can also close it again.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * Every coined word on the dashboard, defined once.
 *
 * One map rather than a definition at each call site, because the same word appearing on four pages with
 * four slightly different glosses is how a vocabulary stops being one. If a definition here is wrong, it
 * is wrong in one place.
 *
 * The wording is deliberately close to the copy already used in `STATE_COPY` and on the pages, so a
 * reader who checks a definition against the surrounding prose finds them saying the same thing.
 */
export const TERMS: Record<string, { readonly gloss: string; readonly sting?: string }> = {
  pin: {
    gloss:
      "One publisher's exact skill bytes, bound on chain to the specific set of powers that version declared.",
    sting: "The unit everything else here refers to. A new release is a new pin, never an edit.",
  },
  drift: {
    gloss:
      "The code on disk no longer hashes to the version that was approved. The publisher shipped an update.",
    sting: "Drift is not an accusation. Most drift is an ordinary release.",
  },
  bond: {
    gloss:
      "Collateral the publisher locks at publish time, priced by how much the skill may do rather than by what it is worth.",
    sting: "Blast radius, not value. A skill that can move a whole balance costs more to publish.",
  },
  slash: {
    gloss: "The bond is taken, because equivocation was proven against the publisher on chain.",
    sting: "Nobody decides this. It is the outcome of a proof anyone can submit.",
  },
  equivocation: {
    gloss:
      "Publishing two different sets of bytes under one version string, so the same name resolves to conflicting code.",
    sting: "This is the thing the bond is actually against, and it is provable rather than judged.",
  },
  attestation: {
    gloss:
      "The signed claim about which skill made a call. It is asserted by the client, not proven by the chain.",
    sting: "The honest gap in this design. Closing it needs a TEE, which this does not have.",
  },
  delegation: {
    gloss:
      "The EIP-7702 pointer that makes an ordinary account run the guard's code when it settles a call.",
    sting: "23 bytes, with room for exactly one address. Move it and enforcement stops silently.",
  },
  guard: {
    gloss:
      "LockstepGuard. The code that compares the approved hash against the live one and refuses the call when they differ.",
    sting: "It never reads the skill, only hashes, so there is nothing in it to talk round.",
  },
  lens: {
    gloss:
      "LockstepLens. A read-only contract that answers many registry questions in one call, so this page can load in one round trip.",
    sting: "It holds no state and can change no state. Removing it would only make this slower.",
  },
  settlement: {
    gloss:
      "The moment the account actually moves funds. Where the check happens, rather than at proposal time.",
    sting: "Checking earlier would be advice. Checking here is enforcement.",
  },
  "live hash": {
    gloss:
      "What the registry returns for a pin right now, which is what the guard will compare against.",
    sting: "Zero for a revoked or slashed pin, which is why those refuse rather than merely warn.",
  },
};

export function Term({ name, children }: { name: keyof typeof TERMS | string; children?: ReactNode }) {
  const entry = TERMS[name];
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  /*
   * An unknown key renders as plain text rather than throwing.
   *
   * A missing definition is a copy bug, not a reason to blank a page mid-sentence. The test suite fails
   * on it instead, which is where that belongs.
   */
  const label = children ?? name;

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // A tap elsewhere should dismiss it, the same as tapping the trigger again.
    const onDown = (event: PointerEvent) => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (entry === undefined) return <>{label}</>;

  return (
    <span ref={wrap} className="relative inline-block">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        /*
         * Mouse only. On a touch screen `pointerenter` arrives with the tap and no `pointerleave` ever
         * follows, so an ungated version opens the panel and leaves it open, and the click toggle then
         * closes it immediately — a tap that appears to do nothing.
         */
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setOpen(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setOpen(false);
        }}
        // Keyboard. `onFocus` rather than CSS :focus-visible so one state drives every path.
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={cx(
          "cursor-help rounded-sm underline decoration-dotted decoration-from-font underline-offset-[0.2em]",
          "font-semibold text-inherit transition-colors hover:text-text focus-visible:outline-2",
          open && "text-text",
        )}
      >
        {label}
      </button>

      {open ? (
        <span
          id={id}
          role="tooltip"
          /*
           * Width is capped against the viewport, not just in rem. A 16rem panel anchored to a word near
           * the right edge of a phone otherwise runs off screen, and the definition a touch user just
           * asked for is the half they cannot read.
           */
          className="chunk absolute top-full left-0 z-50 mt-2 block w-[max(16rem,100%)] max-w-[min(20rem,calc(100vw-2rem))] rounded-xl bg-panel px-3 py-2.5 text-left normal-case"
        >
          <span className="shout block text-[0.55rem] text-faint">{name}</span>
          <span className="mt-1 block text-[0.7rem] leading-relaxed font-semibold text-text">
            {entry.gloss}
          </span>
          {entry.sting === undefined ? null : (
            <span className="mt-1.5 block text-[0.65rem] leading-relaxed text-muted">{entry.sting}</span>
          )}
        </span>
      ) : null}
    </span>
  );
}
