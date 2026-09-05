"use client";

/**
 * The theme control: a three-way segmented switch.
 *
 * A segmented control rather than a cycling icon button. A single button that rotates through
 * three states never tells you what the third one is, and "system" is invisible in that design --
 * you cannot see whether you are following the OS or happen to match it. Three labelled segments
 * make the current state and the alternatives readable at a glance.
 *
 * Built on radio inputs, so it is a real radio group: arrow keys move between options and a
 * screen reader announces the selected one, both for free.
 */

import { useId } from "react";

import { SPRING_SOFT, motion } from "./motion";
import { cx } from "./ui";
import type { ThemeChoice } from "./theme";
import { useTheme } from "./theme";

const OPTIONS: readonly { value: ThemeChoice; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Always light, whatever the system is set to" },
  { value: "system", label: "Auto", hint: "Follow the operating system, and keep following it" },
  { value: "dark", label: "Dark", hint: "Always dark, whatever the system is set to" },
];

export function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  const group = useId();

  return (
    <fieldset
      className="chunk flex items-center gap-0.5 rounded-pill bg-raise p-1.5"
      aria-label="Colour theme"
    >
      {OPTIONS.map((option) => {
        const active = choice === option.value;
        const id = `${group}-${option.value}`;

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
                "shout relative block cursor-pointer rounded-pill px-3 py-1 text-label transition-colors select-none",
                active ? "text-pinned-ink" : "text-faint hover:text-muted",
                // The ring lands on the label, since the input itself is visually hidden.
                "peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-pinned",
              )}
            >
              {active ? (
                <motion.span
                  layoutId={`${group}-thumb`}
                  transition={SPRING_SOFT}
                  className="chunk absolute inset-0 rounded-pill bg-pinned-tint [--line:var(--pinned)]"
                />
              ) : null}
              <span className="relative">{option.label}</span>
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

function Sun() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.6">
      <circle cx="12" cy="12" r="4.2" />
      <path strokeLinecap="round" d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
    </svg>
  );
}

function Moon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2Z" />
    </svg>
  );
}
