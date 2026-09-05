"use client";

/**
 * The theme control: three small icon targets, one per choice.
 *
 * Three targets rather than a cycling icon button. A single button that rotates through three states
 * never tells you what the third one is, and "system" is invisible in that design -- you cannot see
 * whether you are following the OS or happen to match it. Three separate targets keep all three states
 * visible and directly selectable.
 *
 * Built on radio inputs, so it is a real radio group: arrow keys move between options and a
 * screen reader announces the selected one, both for free. The words are `sr-only` rather than absent,
 * so nothing here is available only as a picture.
 */

import { useId } from "react";

import { SPRING_SOFT, motion } from "./motion";
import { cx } from "./ui";
import type { ThemeChoice } from "./theme";
import { useTheme } from "./theme";

const OPTIONS: readonly {
  value: ThemeChoice;
  label: string;
  hint: string;
  icon: () => React.ReactElement;
}[] = [
  { value: "light", label: "Light", hint: "Always light, whatever the system is set to", icon: Sun },
  {
    value: "system",
    label: "Auto",
    hint: "Follow the operating system, and keep following it",
    icon: Monitor,
  },
  { value: "dark", label: "Dark", hint: "Always dark, whatever the system is set to", icon: Moon },
];

/**
 * Three icons, 24px each, no labels and no container.
 *
 * ## Why this shrank
 *
 * It was three text segments — LIGHT · AUTO · DARK — in a bordered pill with padding, which came to
 * roughly 150px of the navigation bar. That is more room than the wallet menu, for a control a reader
 * touches once and then never again. The old comment defended the labels on the grounds that a cycling
 * icon button hides the third state, which is true and is why this is still three separate targets rather
 * than one that cycles: all three states remain visible and directly selectable. What went is the words,
 * the border and the padding, none of which were carrying the meaning.
 *
 * A sun, a monitor and a moon are as close to universal as interface iconography gets, and every one of
 * them keeps its `title` and an `sr-only` label, so nothing is only available as a picture.
 *
 * Still radio inputs, so arrow keys move between the options and a screen reader announces the group and
 * the selection. That was the reason for the original design and it survives the shrink.
 */
export function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  const group = useId();

  return (
    <fieldset className="flex items-center" aria-label="Colour theme">
      {OPTIONS.map((option) => {
        const active = choice === option.value;
        const id = `${group}-${option.value}`;
        const Icon = option.icon;

        return (
          <div key={option.value} className="relative">
            <input
              id={id}
              type="radio"
              name={group}
              value={option.value}
              checked={active}
              onChange={() => setChoice(option.value)}
              className="peer sr-only"
            />
            <label
              htmlFor={id}
              title={option.hint}
              className={cx(
                "grid size-6 cursor-pointer place-items-center rounded transition-colors select-none",
                active ? "bg-raise text-text" : "text-faint hover:text-muted",
                // The ring lands on the label, since the input itself is visually hidden.
                "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-pinned",
              )}
            >
              <Icon />
              <span className="sr-only">{option.label}</span>
            </label>
          </div>
        );
      })}
    </fieldset>
  );
}

/**
 * A compact variant for tight spaces: one button showing the resolved theme.
 *
 * Only the icon crossfades and rotates; there is no state cycling, so it opens nothing and hides
 * nothing. Currently unused by the header, kept for the mobile layout.
 */
export function ThemeIconToggle() {
  const { resolved, setChoice } = useTheme();
  const dark = resolved === "dark";

  return (
    <button
      type="button"
      onClick={() => setChoice(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="pop press grid size-10 place-items-center rounded-pill bg-panel text-muted"
    >
      <motion.span
        key={resolved}
        initial={{ rotate: -90, opacity: 0, scale: 0.7 }}
        animate={{ rotate: 0, opacity: 1, scale: 1 }}
        transition={SPRING_SOFT}
        className="grid place-items-center"
      >
        {dark ? <Moon /> : <Sun />}
      </motion.span>
    </button>
  );
}

/*
 * 14px glyphs at stroke 2, inside a 24px target.
 *
 * The stroke dropped from 2.6, which was tuned to sit beside 2px borders and an 800-weight label. At this
 * size 2.6 closes the sun's rays into a blob.
 */
function Sun() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4.2" />
      <path strokeLinecap="round" d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
    </svg>
  );
}

/** A display, for "follow the system". The convention, and it reads at 14px where a cog would not. */
function Monitor() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path strokeLinecap="round" d="M9 20h6M12 16v4" />
    </svg>
  );
}

function Moon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
    </svg>
  );
}
