"use client";

/**
 * One filter bar, for every list in the app.
 *
 * ## Why this is a primitive and not three implementations
 *
 * The app had no search and no filters at all, which on a fixture of six pins looks like a clean interface
 * and against a real registry is a table you scroll. Three lists need them -- pins, publishers, approvals --
 * and the last time three surfaces each grew their own version of one control, the result was seventeen
 * button shapes and six input styles. So the control exists once, before there is anything to consolidate.
 *
 * ## The two rules it enforces
 *
 * Active filters are always visible, as removable chips, never only inside a dropdown. The single
 * most-reported cause of "the dashboard is wrong" is a filter the reader set three views ago and forgot: they
 * see a short list, conclude the data is broken, and file a bug against the product. A chip they can see and
 * dismiss makes that impossible.
 *
 * And the count is stated. "Showing 3 of 12" is the difference between a list that has been narrowed and a
 * registry that is nearly empty, which on this product specifically are conclusions a reader might act on.
 */

import type { ReactNode } from "react";
import { useId } from "react";

import { TextInput, cx } from "./ui";

export interface FilterChip {
  /** Reads as the state, not as the control: "state: revoked", not "filter by state". */
  readonly label: string;
  readonly onClear: () => void;
}

export function FilterBar({
  search,
  onSearch,
  searchLabel,
  placeholder,
  chips,
  onClearAll,
  showing,
  total,
  noun,
  children,
}: {
  search: string;
  onSearch: (next: string) => void;
  /** Names the field for a screen reader. There is no visible label; the placeholder is not one. */
  searchLabel: string;
  placeholder: string;
  readonly chips: readonly FilterChip[];
  onClearAll: () => void;
  showing: number;
  total: number;
  /** Plural noun for the count line: "pins", "publishers". */
  noun: string;
  /** Extra controls, such as a state picker. Sit beside the field, before the chips. */
  children?: ReactNode;
}) {
  const id = useId();
  const filtered = chips.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 sm:max-w-xs">
          <TextInput
            id={id}
            value={search}
            onChange={onSearch}
            aria-label={searchLabel}
            placeholder={placeholder}
            /*
              Monospace, because most of what gets typed in here is a hash or an address pasted from
              somewhere else, and a proportional face makes those impossible to compare against the column
              they are being matched against.
            */
            mono
          />
        </span>
        {children}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/*
          The count, first, and always shown.

          Not only when something is filtered. A reader who sees "12 pins" and then "3 of 12 pins" has been
          told what changed; one who sees a number appear from nowhere has to work out whether it is a new
          fact or a narrowed one.
        */}
        <p aria-live="polite" className="shout text-label text-faint">
          {filtered ? `Showing ${showing} of ${total} ${noun}` : `${total} ${noun}`}
        </p>

        {chips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            onClick={chip.onClear}
            className={cx(
              "chunk press group inline-flex items-center gap-1.5 rounded-pill bg-raise px-2.5 py-1",
              "text-label text-muted hover:text-text",
            )}
          >
            <span className="shout">{chip.label}</span>
            <span aria-hidden className="text-faint group-hover:text-text">
              &times;
            </span>
            <span className="sr-only">— remove this filter</span>
          </button>
        ))}

        {chips.length > 1 ? (
          <button
            type="button"
            onClick={onClearAll}
            className="press rounded-pill px-2 py-1 text-label text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Clear all
          </button>
        ) : null}
      </div>

      {/*
        The empty result, explained rather than left blank.

        Distinct from a list's `Empty` state on purpose: "no pins have been published" and "no pins match
        what you typed" are different facts, and showing the first when the second is true would tell a
        reader the registry is empty when they have simply mistyped a hash.
      */}
      {filtered && showing === 0 ? (
        <p className="text-sm leading-relaxed font-semibold text-muted">
          Nothing matches. Every {noun.replace(/s$/, "")} is still there &mdash; clear the filters above to see
          them.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Case-insensitive substring match over a set of fields.
 *
 * Shared so the three lists cannot disagree about what "matches" means, and so every one of them searches
 * hashes and addresses rather than only names. That is the difference that matters: a reader arrives with a
 * hash pasted from a CI log or a badge, and a search that only looked at names would refuse the input the
 * product itself hands out.
 */
export function matches(needle: string, ...fields: readonly (string | undefined)[]): boolean {
  const trimmed = needle.trim().toLowerCase();
  if (trimmed === "") return true;
  return fields.some((field) => field !== undefined && field.toLowerCase().includes(trimmed));
}
