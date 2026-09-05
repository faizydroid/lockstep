"use client";

/**
 * The surface kit. Cards, buttons, pills, hashes, stats, tables, meters.
 *
 * One file because these pieces only make sense together: the radius of a pill is chosen against
 * the radius of the card it sits in, and the depth of a button's underside has to match the depth
 * of the panel it sits on or the page looks like two different products. Anything that grows its
 * own state or data needs lives elsewhere.
 *
 * Every colour here is a semantic token -- `bg-panel`, `text-muted`, `border-line` -- never a
 * literal. That is what makes one component work on both grounds.
 *
 * The visual language is Duolingo's, and it rests on three things, in order of how much they
 * matter:
 *
 *   1. A hard, un-blurred bottom edge. Every surface is a tile with a visible side, and pressing
 *      one travels it down onto its own base. No ambient shadows anywhere.
 *   2. Thick borders. 2px, in a colour you can actually see, not a hairline at 8% alpha.
 *   3. Heavy round type. Nunito at 700-800, uppercase and tracked out on anything clickable.
 *
 * One deliberate departure from Duolingo: their buttons put white text on saturated fills, which
 * measures 2.09:1 on Feather Green and fails AA. Every solid fill here carries a near-black label
 * instead, which lets the hue stay at full brightness and measures 4.99-10.61. See --on-face.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import { commonPrefixLength, shortAddress, shortHash } from "@/lib/format";
import type { PinState } from "@/lib/model";
import { isSafeHref } from "@/lib/untrusted";

import { cx } from "@/lib/cx";

import { Guard } from "./guard";
import { Pressable, SPRING_FIRM, motion } from "./motion";

/* ------------------------------------------------------------------ surfaces */

/**
 * @remarks
 * The `spotlight` prop is gone. It was a highlight that tracked the pointer across large cards, on the
 * reasoning that a flat fill reads as dead space -- which was true when every other surface had a 4px
 * underside and a 2px border to compete with. With a hairline border and no shadows anywhere, a moving
 * gradient inside a card is the loudest thing on the page, and it was on the two cards carrying the most
 * important readings in the app: the fingerprint comparison and the enforcement verdict.
 *
 * A flat fill is not dead space if the thing inside it is worth reading.
 */
export function Card({
  children,
  className,
  interactive = false,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  /** Tints the border, for a card that is itself a status. */
  tone?: Tone;
}) {
  const base = cx(
    "relative overflow-hidden rounded-2xl bg-panel p-6",
    tone === "neutral" ? "chunk" : cx("chunk", CARD_TONE[tone]),
    className,
  );

  if (!interactive) return <div className={base}>{children}</div>;

  return (
    <Pressable className={cx(base, "cursor-pointer")} lift={0}>
      {children}
    </Pressable>
  );
}

/**
 * Overrides for a status-coloured card.
 *
 * `--pop` is the underside colour and `--line` the border, both read by the `.pop` utility. Setting
 * the custom properties rather than adding a second box-shadow keeps one shadow declaration in
 * play, so the press state in `.press` still has exactly one thing to cancel.
 */
const CARD_TONE: Record<Exclude<Tone, "neutral">, string> = {
  bonded: "[--pop:var(--bonded-shade)] [--line:var(--bonded)]",
  pinned: "[--pop:var(--pinned-shade)] [--line:var(--pinned)]",
  attention: "[--pop:var(--attention-shade)] [--line:var(--attention)]",
  revoked: "[--pop:var(--revoked-shade)] [--line:var(--revoked)]",
  equivocated: "[--pop:var(--equivocated-shade)] [--line:var(--equivocated)]",
};

/** A titled region. The eyebrow carries the section name, the title carries the claim. */
export function Section({
  eyebrow,
  title,
  description,
  children,
  aside,
  level = 2,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  /** Optional: a section that is only a heading and a description is a legitimate shape. */
  children?: ReactNode;
  aside?: ReactNode;
  /**
   * Heading level. `1` for the section that names the route.
   *
   * Seven of the ten product routes had no `h1` at all, because every `Section` hardcoded an `h2` and every
   * page is built from `Section`s. A document whose outline starts at level two is a document a screen
   * reader user cannot get their bearings in, and it is the single most common heading defect there is.
   *
   * The size does not change with the level. On these pages the section that names the route is not visually
   * larger than the others, and it should not be — the level is a statement about structure, not about type
   * size, and conflating the two is why so many pages end up with three h1s or none.
   */
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          {eyebrow === undefined ? null : (
            <p className="shout text-label text-faint">{eyebrow}</p>
          )}
          <Heading className="font-display text-2xl leading-tight text-text sm:text-3xl">
            {title}
          </Heading>
          {description === undefined ? null : (
            <p className="measure text-sm leading-relaxed text-muted">{description}</p>
          )}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------- buttons */

type Tone = "neutral" | "bonded" | "pinned" | "attention" | "revoked" | "equivocated";

/**
 * Solid fills, each with a near-black label and its own darker underside.
 *
 * The label is `text-on-face` for every tone rather than white, which is what lets the fills stay
 * at Duolingo's full saturation while clearing AA. Verified per hue in .scratch/contrast.mjs.
 */
const BUTTON_SOLID: Record<Tone, string> = {
  neutral: "bg-raise-strong text-text [--pop:var(--shade)]",
  bonded: "bg-bonded text-on-face [--pop:var(--bonded-shade)]",
  pinned: "bg-pinned text-on-face [--pop:var(--pinned-shade)]",
  attention: "bg-attention text-on-face [--pop:var(--attention-shade)]",
  revoked: "bg-revoked text-on-face [--pop:var(--revoked-shade)]",
  equivocated: "bg-equivocated text-on-face [--pop:var(--equivocated-shade)]",
};

/** Outlined, for secondary actions. Border and label in the hue's text-safe ink. */
const BUTTON_QUIET: Record<Tone, string> = {
  neutral: "bg-panel text-muted [--line:var(--line-strong)] [--pop:var(--shade)]",
  bonded: "bg-panel text-bonded-ink [--line:var(--bonded)] [--pop:var(--bonded-shade)]",
  pinned: "bg-panel text-pinned-ink [--line:var(--pinned)] [--pop:var(--pinned-shade)]",
  attention: "bg-panel text-attention-ink [--line:var(--attention)] [--pop:var(--attention-shade)]",
  revoked: "bg-panel text-revoked-ink [--line:var(--revoked)] [--pop:var(--revoked-shade)]",
  equivocated:
    "bg-panel text-equivocated-ink [--line:var(--equivocated)] [--pop:var(--equivocated-shade)]",
};

/*
 * Fixed heights rather than vertical padding.
 *
 * The audit found roughly ten distinct control heights across the app, several of them a couple of pixels
 * apart, because every bespoke button picked its own `py-*`. Naming the height instead means two buttons of
 * the same size always line up, including when one has an icon and the other does not.
 *
 * 36 / 40 / 44px. The top of the range is a comfortable touch target and the bottom is the smallest thing
 * that still reads as a button rather than as a chip.
 */
const BUTTON_SIZE = {
  sm: "h-9 px-3.5 text-note",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-6 text-sm",
} as const;

/**
 * The pressable button.
 *
 * `.pop-bare` plus `.press` on a solid fill: the fill supplies its own edge so no border is drawn,
 * and pressing travels it 4px down onto its underside. Outlined variants use `.pop`, which adds the
 * 2px border back.
 *
 * Renders as a `button` by default and an `a` when `href` is set, because a navigation that looks
 * like a button should still be a link -- middle-click, open in new tab and the browser's own
 * status bar all depend on it.
 */
export function Button({
  children,
  tone = "bonded",
  variant = "solid",
  size = "md",
  href,
  onClick,
  disabled = false,
  className,
  type = "button",
  full = false,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  tone?: Tone;
  variant?: "solid" | "quiet";
  size?: keyof typeof BUTTON_SIZE;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  full?: boolean;
  "aria-label"?: string;
}) {
  /*
   * Sentence case and the sans face, not `.shout`.
   *
   * `.shout` is now the mono label voice used by eyebrows, table heads and pills, and it was previously
   * doing that job *and* this one -- so "press this" and "this is a column of data" were set identically.
   * An uppercase mono button also costs about 15% more width than sentence case at the same size, which in
   * a dense interface is the difference between two buttons fitting on a row and not.
   */
  const shape = cx(
    "press inline-flex items-center justify-center gap-2 rounded-md font-medium select-none",
    variant === "solid" ? "pop-bare" : "pop",
    variant === "solid" ? BUTTON_SOLID[tone] : BUTTON_QUIET[tone],
    BUTTON_SIZE[size],
    full && "w-full",
    // Loses the underside as well as the colour: a disabled control should not look pressable.
    disabled && "pointer-events-none opacity-45",
    className,
  );

  /*
   * An `href` is checked before it becomes an anchor, and fails closed to a disabled button.
   *
   * React escapes text but not URLs, so `javascript:` in an anchor is a working script. Every call
   * site in this app passes a literal today, and "every call site today" is not a security property --
   * this component is exported, and the next person to wire a URL through it from chain data or a query
   * string should not be the one who has to remember. `isSafeHref` allows a fragment, a root-relative
   * path, or absolute https, and drops everything else rather than rewriting it: turning an attacker's
   * URL into a slightly different attacker's URL is not a defence.
   */
  if (href !== undefined) {
    if (!isSafeHref(href)) {
      return (
        <button type="button" disabled className={cx(shape, "pointer-events-none opacity-45")} aria-label={ariaLabel}>
          {children}
        </button>
      );
    }
    return (
      <a href={href} className={shape} aria-label={ariaLabel}>
        {children}
      </a>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={shape}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------------- pills */

/**
 * Tinted fill, 2px outline in the ink, uppercase label.
 *
 * The outline is drawn in `-ink` rather than the bright face on purpose. The light-theme tints
 * measure only 1.10-1.21 against a white panel, so the fill alone does not delineate the pill; the
 * ink outline measures 4.97-5.47 and does. Deepening the tints instead would have broken the
 * ink-on-tint ratios, which clear 4.5 by as little as 0.02.
 */
const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-raise text-muted [--line:var(--line-strong)]",
  bonded: "bg-bonded-tint text-bonded-ink [--line:var(--bonded-ink)]",
  pinned: "bg-pinned-tint text-pinned-ink [--line:var(--pinned-ink)]",
  attention: "bg-attention-tint text-attention-ink [--line:var(--attention-ink)]",
  revoked: "bg-revoked-tint text-revoked-ink [--line:var(--revoked-ink)]",
  equivocated: "bg-equivocated-tint text-equivocated-ink [--line:var(--equivocated-ink)]",
};

const DOT_CLASS: Record<Tone, string> = {
  neutral: "bg-muted",
  bonded: "bg-bonded",
  pinned: "bg-pinned",
  attention: "bg-attention",
  revoked: "bg-revoked",
  equivocated: "bg-equivocated",
};

export function Pill({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "chunk shout inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-label whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Maps a pin's state to its tone and the words a reader needs. */
const STATE_COPY: Record<PinState, { tone: Tone; label: string; title: string }> = {
  bonded: {
    tone: "bonded",
    label: "bonded",
    title: "Live, with collateral posted against the publisher's version claim.",
  },
  pinned: {
    tone: "pinned",
    label: "pinned, no bond",
    title: "Live, but no bond is at stake, so there is nothing to slash if the publisher equivocates.",
  },
  revoked: {
    tone: "revoked",
    label: "revoked",
    title: "The publisher withdrew this release. The guard treats it as having no hash.",
  },
  equivocated: {
    tone: "equivocated",
    label: "publisher slashed",
    title: "The publisher shipped conflicting bytes under one version string and lost their bond.",
  },
};

export function StatePill({ state }: { state: PinState }) {
  const copy = STATE_COPY[state];
  return (
    <Pill tone={copy.tone} title={copy.title}>
      <span className={cx("size-2 rounded-pill", DOT_CLASS[copy.tone])} />
      {copy.label}
    </Pill>
  );
}

/* ------------------------------------------------------------ speech bubbles */

/**
 * A speech bubble with a tail, for anything the interface says rather than reports.
 *
 * Duolingo uses these to separate instruction from content, and the distinction is genuinely useful
 * here: this app mixes on-chain facts with explanations of what those facts mean. A fact goes in a
 * table; an explanation goes in a bubble, so a reader can tell at a glance which is which and never
 * mistakes commentary for data.
 *
 * The tail is a rotated square with two of its borders showing, positioned to overlap the bubble's
 * own border and cover it. Cheap, and it inherits the bubble's border colour automatically.
 */
export function Bubble({
  children,
  tone = "neutral",
  side = "left",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  /** Which edge the tail sits on. `left` for a bubble beside a mascot facing right. */
  side?: "left" | "top";
  className?: string;
}) {
  const skin =
    tone === "neutral"
      ? "bg-panel text-muted [--line:var(--line-strong)]"
      : TONE_CLASS[tone];

  /*
   * The tone class sits on the wrapper, not on the bubble.
   *
   * It carries `[--line:...]`, and the tail is a sibling of the bubble rather than a child. Setting
   * the tone on the bubble left the tail resolving `--line` from the theme default, so a green bubble
   * grew a grey tail. Both elements need to be inside the scope that defines it.
   */
  return (
    <div className={cx("relative", skin, className)}>
      <div className="chunk rounded-2xl px-5 py-4 text-sm leading-relaxed font-semibold">
        {children}
      </div>
      <span
        aria-hidden
        className={cx(
          "absolute size-3 rotate-45",
          "border-b border-l border-[var(--line)]",
          tone === "neutral" ? "bg-panel" : TONE_BG[tone],
          side === "left"
            ? "top-6 -left-[7px] rounded-bl-[3px]"
            : "-top-[7px] left-8 rotate-[135deg] rounded-bl-[3px]",
        )}
      />
    </div>
  );
}

/** Just the fill, for the bubble tail, which cannot inherit a background from a compound class. */
const TONE_BG: Record<Exclude<Tone, "neutral">, string> = {
  bonded: "bg-bonded-tint",
  pinned: "bg-pinned-tint",
  attention: "bg-attention-tint",
  revoked: "bg-revoked-tint",
  equivocated: "bg-equivocated-tint",
};

/* --------------------------------------------------------------------- meters */

/**
 * A horizontal progress bar.
 *
 * Duolingo's is the most recognisable element of their interface after the buttons, and the reason
 * it works is the inner highlight: a lighter stripe along the top of the fill that makes it read as
 * a glossy capsule rather than a flat rectangle.
 *
 * `value` is 0-1 and is clamped, because several of these are driven by ratios computed from chain
 * reads where a denominator of zero is possible.
 */
export function Meter({
  value,
  tone = "bonded",
  label,
  className,
  height = "md",
}: {
  value: number;
  tone?: Exclude<Tone, "neutral">;
  label?: string;
  className?: string;
  height?: "sm" | "md";
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;

  return (
    <div className={className}>
      {label === undefined ? null : (
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="shout text-label text-faint">{label}</span>
          <span className={cx("text-xs font-extrabold", INK_CLASS[tone])}>{Math.round(pct)}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "progress"}
        className={cx(
          "relative w-full overflow-hidden rounded-pill bg-raise-strong",
          height === "sm" ? "h-2.5" : "h-4",
        )}
      >
        <motion.div
          className={cx("relative h-full rounded-pill", DOT_CLASS[tone])}
          initial={{ width: 0 }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* The gloss. Inset so it never reaches the capsule's own edge. */}
          {height === "md" ? (
            <span
              aria-hidden
              className="absolute inset-x-1.5 top-1 h-1 rounded-pill bg-white/35"
            />
          ) : null}
        </motion.div>
      </div>
    </div>
  );
}

const INK_CLASS: Record<Exclude<Tone, "neutral">, string> = {
  bonded: "text-bonded-ink",
  pinned: "text-pinned-ink",
  attention: "text-attention-ink",
  revoked: "text-revoked-ink",
  equivocated: "text-equivocated-ink",
};

/**
 * A circular progress ring with a value in the middle.
 *
 * Two stroked circles, the second rotated a quarter turn so it starts at twelve o'clock, with
 * `pathLength` doing the work instead of a hand-computed stroke-dasharray. `pathLength={1}`
 * normalises the circumference so `strokeDashoffset` can be expressed as a plain 0-1 fraction and
 * the radius can change without recomputing anything.
 */
export function Ring({
  value,
  tone = "bonded",
  size = 96,
  children,
  className,
}: {
  value: number;
  tone?: Exclude<Tone, "neutral">;
  size?: number;
  children?: ReactNode;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const stroke = size >= 88 ? 9 : 7;
  const r = (size - stroke) / 2;

  return (
    <div className={cx("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="absolute inset-0">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--raise-strong)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`var(--${tone})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={1}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          initial={{ strokeDashoffset: 1 }}
          whileInView={{ strokeDashoffset: 1 - pct }}
          viewport={{ once: true }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          style={{ strokeDasharray: 1 }}
        />
      </svg>
      <div className="relative text-center leading-none">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------- hashes */

/**
 * A hash or address, abbreviated but copyable.
 *
 * Click to copy, because the alternative is a reader squinting at twelve characters and retyping
 * them. The full value is on `title` so hover reveals it without a click, and the copied state is
 * announced rather than only shown, since a colour change alone is invisible to a screen reader.
 */
export function HashChip({
  value,
  kind = "hash",
  className,
  emphasis = "normal",
}: {
  value: string;
  kind?: "hash" | "address";
  className?: string;
  emphasis?: "normal" | "quiet";
}) {
  const [copied, setCopied] = useState(false);
  const shown = kind === "address" ? shortAddress(value) : shortHash(value);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be refused; the title attribute still carries the full value.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={`${value}\n\nClick to copy`}
      className={cx(
        "hash press group inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
        "bg-sunken pop-sm [--pop:var(--line)]",
        emphasis === "quiet" ? "text-faint hover:text-muted" : "text-muted hover:text-text",
        className,
      )}
    >
      {shown}
      <span aria-live="polite" className="sr-only">
        {copied ? "copied" : ""}
      </span>
      <motion.span
        aria-hidden
        animate={{ opacity: copied ? 1 : 0.4, scale: copied ? 1.2 : 1 }}
        transition={SPRING_FIRM}
        className={cx("text-label", copied ? "text-bonded-ink" : "")}
      >
        {copied ? "\u2713" : "\u29c9"}
      </motion.span>
    </button>
  );
}

/**
 * Two hashes, with their shared prefix dimmed.
 *
 * The centrepiece of the whole interface. When a publisher swaps the bytes under a version string,
 * the approved hash and the hash on disk usually share a few leading characters and then diverge
 * completely. Dimming what matches puts the eye exactly on the first character that does not,
 * which is the difference the guard acted on.
 *
 * The divergent tail wipes in from the split point rather than fading as a block, so the animation
 * itself shows where the two stop agreeing.
 */
export function HashDiff({
  approved,
  current,
  labels = { approved: "approved", current: "on disk" },
}: {
  approved: string;
  current: string;
  labels?: { approved: string; current: string };
}) {
  const shared = commonPrefixLength(approved, current);

  return (
    <div className="space-y-2">
      <HashDiffRow label={labels.approved} value={approved} shared={shared} tone="bonded" delay={0} />
      <HashDiffRow label={labels.current} value={current} shared={shared} tone="revoked" delay={0.12} />
    </div>
  );
}

function HashDiffRow({
  label,
  value,
  shared,
  tone,
  delay,
}: {
  label: string;
  value: string;
  shared: number;
  tone: "bonded" | "revoked";
  delay: number;
}) {
  const common = value.slice(0, shared);
  const rest = value.slice(shared);

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
      <span className="shout w-20 shrink-0 text-label text-faint">{label}</span>
      <code
        className={cx(
          "hash chunk overflow-x-auto rounded-md bg-sunken px-3 py-2 text-xs",
          tone === "bonded" ? "[--line:var(--bonded)]" : "[--line:var(--revoked)]",
        )}
      >
        <span className="text-faint">{common}</span>
        <motion.span
          initial={{ opacity: 0, x: -4 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
          className={cx("font-extrabold", tone === "bonded" ? "text-bonded-ink" : "text-revoked-ink")}
        >
          {rest}
        </motion.span>
      </code>
    </div>
  );
}

/* --------------------------------------------------------------------- stats */

const ACCENT_CLASS: Record<Tone, string> = {
  neutral: "text-text",
  bonded: "text-bonded-ink",
  pinned: "text-pinned-ink",
  attention: "text-attention-ink",
  revoked: "text-revoked-ink",
  equivocated: "text-equivocated-ink",
};

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div
      className={cx(
        "pop h-full rounded-xl bg-panel p-5",
        tone === "neutral" ? "" : CARD_TONE[tone],
      )}
    >
      <p className="shout text-label text-faint">{label}</p>
      <p
        className={cx(
          "font-display mt-2 text-4xl leading-none font-extrabold",
          ACCENT_CLASS[tone],
        )}
      >
        {value}
      </p>
      {hint === undefined ? null : (
        <p className="mt-2 text-xs leading-relaxed font-semibold text-muted">{hint}</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- tables */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="pop overflow-hidden rounded-xl bg-panel">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    </div>
  );
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cx("shout bg-raise px-4 py-3 text-left text-label text-faint", className)}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={cx("border-t border-line px-4 py-3 align-middle font-semibold", className)}>
      {children}
    </td>
  );
}

/* ------------------------------------------------------------- empty states */

/**
 * An empty state that explains rather than apologises.
 *
 * Several lists here can be legitimately empty in a way that is worth understanding -- refused
 * calls emit no logs, so that feed is empty unless a trace-capable node is watching. Saying so is
 * more useful than "no data".
 */
/**
 * @param mood Which face Guard wears. Defaults to `watching`, which is the honest one for "nothing
 *        here yet" — an empty list is usually a real answer rather than a problem.
 *
 * Guard delivers empty states now, rather than them being centred text in a box.
 *
 * The mascot already existed with four moods and was being used on the overview and in the confirm
 * dialog, which left the emptiest screens in the app as the only ones with nothing on them. That is
 * backwards: an empty state is where a reader most needs to be told what would fill it and why it is
 * blank, and a character saying it lands where a paragraph does not.
 *
 * `watching` and not a sad face. Several of these states are correct outcomes — no refusals recorded
 * is good news, and drawing it as disappointment would teach a reader to read a healthy registry as a
 * broken page.
 */
export function Empty({
  title,
  children,
  mood = "watching",
}: {
  title: string;
  children?: ReactNode;
  mood?: "watching" | "settled" | "alarmed";
}) {
  return (
    <div className="pop rounded-xl bg-panel px-6 py-10">
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
        {/*
          `aria-hidden` on the wrapper, so the mascot is decorative here.

          Guard normally carries `role="img"` and a spoken label, which is right where the face is the
          message. In an empty state the title and paragraph beside it say everything, and a screen
          reader announcing "Guard is watching" before them is noise. Hiding the subtree is the correct
          way to say decorative; passing an empty label would leave an image with no accessible name.

          `bob={false}` because an idling animation is charming in a dashboard header and fidgety
          inside a panel someone is trying to read.
        */}
        <span aria-hidden>
          <Guard mood={mood} size={72} bob={false} />
        </span>

        <div className="min-w-0">
          <p className="font-display text-lg font-extrabold text-text">{title}</p>
          {children === undefined ? null : (
            <p className="mt-2 text-sm leading-relaxed font-semibold text-muted">{children}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- inputs */

/**
 * The one text input.
 *
 * There were three, and the differences were not decisions. The profile fields were
 * `rounded-lg bg-sunken px-3 py-2.5 text-sm font-semibold`; the settings field was
 * `hash rounded-xl ... px-3 py-2 text-sm` with a placeholder colour; the quickstart field was the same in
 * `text-xs`; and the write-action confirmation field had no placeholder colour and no `min-w-0`. Four
 * variants of one control, differing on radius, font, size and padding, each looking reasonable beside the
 * last.
 *
 * `mono` is the only real axis, because it is the only one carrying meaning: an address or a hash must be
 * monospace so a reader can compare it character by character, and prose must not be.
 */
export function TextInput({
  value,
  onChange,
  onEnter,
  mono = false,
  invalid = false,
  describedBy,
  className,
  ...rest
}: {
  value: string;
  onChange: (next: string) => void;
  /** Submit on Enter. None of these live in a `<form>`, so it has to be wired by hand. */
  onEnter?: () => void;
  mono?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
  id?: string;
  placeholder?: string;
  maxLength?: number;
  "aria-label"?: string;
}) {
  return (
    <input
      {...rest}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={
        onEnter === undefined
          ? undefined
          : (event) => {
              if (event.key === "Enter") onEnter();
            }
      }
      autoComplete="off"
      spellCheck={false}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      className={cx(
        "chunk h-10 w-full min-w-0 rounded-md bg-sunken px-3 text-sm text-text placeholder:text-faint",
        mono && "hash",
        invalid && "[--line:var(--revoked)]",
        className,
      )}
    />
  );
}

/**
 * The one segmented control.
 *
 * Four of these existed at three different sizes: the badge state picker and the settings motion picker were
 * byte-identical, the account profile/settings tabs were the same idea two pixels shorter, and the theme
 * toggle was smaller again with a sliding thumb. A reader cannot tell that three of those are the same
 * control, which is the whole argument for a primitive.
 *
 * Uses `aria-pressed` on plain buttons rather than `role="tablist"`. Two of the four switch a visible panel
 * and two only change a value, and a tablist that does not own a tabpanel is worse than no tablist —
 * a screen reader announces "tab 1 of 3" and then nothing changes region. The account page's panel keeps its
 * own semantics.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  readonly options: readonly { readonly value: T; readonly label: string; readonly hint?: string }[];
  value: T;
  onChange: (next: T) => void;
  /** Names the group, since the buttons alone do not say what is being chosen. */
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="chunk inline-flex flex-wrap items-center gap-0.5 rounded-pill bg-raise p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            title={option.hint}
            className={cx(
              "shout press rounded-pill px-3 py-1.5 text-label transition-colors",
              active ? "bg-panel text-text chunk" : "text-muted hover:text-text",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export { cx };
export type { Tone };
