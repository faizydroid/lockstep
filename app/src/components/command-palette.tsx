"use client";

/**
 * The command palette: everything in this app, one keystroke away.
 *
 * ## Why this exists at all
 *
 * There was no search anywhere in the product. Not on `/pins`, not on `/publishers`, not globally — a
 * registry explorer with no way to find a thing in the registry. On a demo fixture of six pins that reads
 * as a clean interface; against a real deployment it is the difference between a tool and a screenshot.
 *
 * A palette rather than a search box in the header, for two reasons. It answers "find a pin" and "go to
 * drift" with one control, which a search box cannot without inventing a second grammar. And ⌘K is a
 * convention a reader arrives already knowing — the same keystroke opens the same thing in Linear, Figma,
 * GitHub, Slack and Notion — so the affordance costs nothing to learn.
 *
 * ## What is in it, and what deliberately is not
 *
 * Routes, pins, and three actions. Publishers are not searchable here because there is no per-publisher
 * route to send anyone to; a result whose only outcome is the same table the reader could already see is a
 * dead end wearing the appearance of a search hit. Publisher addresses are matched *through* pins instead,
 * which is a real answer: it tells you what that publisher has actually published.
 *
 * `/account` is in the route list even though it left the navigation. That was the whole reason to check:
 * moving a destination into a dropdown is only defensible if it stays findable, and this is where it stays
 * findable.
 *
 * A pin result links to `/pins?pin=<id>` rather than constructing a `cast` command here. The Verify block
 * on that page already builds the command from the configured registry address, and two places composing
 * the same command line is how one of them ends up wrong.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { shortAddress } from "@/lib/format";
import { applyRail } from "@/lib/rail";
import type { Pin } from "@/lib/model";
import { displayName } from "@/lib/untrusted";

import { useSnapshot } from "./data";
import { AnimatePresence, motion, useReducedMotion } from "./motion";
import { useSettings } from "./settings";
import { useTheme } from "./theme";
import { cx } from "./ui";

/** Every destination the palette can reach, including the ones that are not in the rail. */
const ROUTES: readonly { label: string; hint: string; href: string }[] = [
  { label: "Dashboard", hint: "Is anything wrong right now", href: "/dashboard" },
  { label: "Drift", hint: "What changed since you approved it", href: "/drift" },
  { label: "Approvals", hint: "What your agent may spend under", href: "/approvals" },
  { label: "Pins", hint: "What each skill is allowed to do", href: "/pins" },
  { label: "Publishers", hint: "Who has money at stake", href: "/publishers" },
  { label: "Bonds", hint: "What a lie costs a publisher", href: "/bonds" },
  { label: "Badge", hint: "Show a pin in your README", href: "/badge" },
  /*
   * The two that are reachable nowhere else in the chrome.
   *
   * `/account` moved into the wallet menu and `#settings` is a tab inside it, so without these two lines a
   * keyboard reader has no path to either that does not go through a mouse and a dropdown.
   */
  { label: "Account", hint: "Whether anything is enforcing your approvals", href: "/account" },
  { label: "Settings", hint: "RPC endpoint, account, motion", href: "/account#settings" },
];

type Result =
  | { readonly kind: "route"; readonly key: string; readonly label: string; readonly hint: string; readonly href: string }
  | { readonly kind: "pin"; readonly key: string; readonly label: string; readonly hint: string; readonly href: string }
  | { readonly kind: "action"; readonly key: string; readonly label: string; readonly hint: string; readonly run: () => void };

const GROUP_LABEL: Record<Result["kind"], string> = {
  route: "Go to",
  pin: "Pins",
  action: "Do",
};

/*
 * One haystack per pin, lowercased once.
 *
 * The hash and the version id are in it deliberately. Comparing a hash is the single most common thing a
 * reader does in this app, and the way they arrive with one is by pasting it — from a CI log, a badge, or
 * the CLI. A search that matched only the name would refuse the input the product itself hands out.
 */
function pinHaystack(pin: Pin): string {
  return [
    displayName(pin.skillName),
    pin.skillVersion === undefined ? "" : displayName(pin.skillVersion, ""),
    pin.skillHash,
    pin.versionId,
    pin.publisher,
    pin.state,
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * The trigger and the dialog, together.
 *
 * One component because the two share the open state and nothing else needs it. The dialog is `fixed`, so
 * being a sibling of a button in the top bar costs it nothing.
 */
export function CommandPalette() {
  const router = useRouter();
  const { snapshot } = useSnapshot();
  const { settings, update } = useSettings();
  const { resolved, setChoice } = useTheme();
  const reduced = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  /*
   * Which modifier to print. The binding accepts both; the label has to pick one.
   *
   * `undefined` until mounted, because a static export has no `navigator` at build time and the prerendered
   * HTML is served to every platform. Printing "⌘K" to a Windows reader is not a cosmetic slip -- it is an
   * instruction that does not work on their keyboard.
   *
   * The placeholder holds the width so the swap is not a layout shift in the middle of the top bar, and it
   * is a non-breaking space rather than a guess, so nobody ever reads the wrong shortcut even for a frame.
   */
  const [mac, setMac] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    setMac(/mac|iphone|ipad|ipod/i.test(navigator.userAgent));
  }, []);

  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    /*
     * Focus goes back where it came from.
     *
     * Without this, dismissing the palette drops focus on <body> and the next Tab starts from the top of the
     * document — which for a keyboard reader means the shortcut costs them their place on the page.
     */
    triggerRef.current?.focus();
  }, []);

  /*
   * ⌘K / Ctrl+K, and Escape while open.
   *
   * `preventDefault` even inside a text field. Ctrl+K is a legacy readline binding in some contexts, but a
   * reader who presses it in 2026 means the palette, and the convention outranks the binding it displaces.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((was) => !was);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const actions = useMemo<Result[]>(
    () => [
      {
        kind: "action",
        key: "action:theme",
        label: resolved === "dark" ? "Switch to the light theme" : "Switch to the dark theme",
        hint: "Overrides the system setting until you change it back",
        run: () => setChoice(resolved === "dark" ? "light" : "dark"),
      },
      {
        kind: "action",
        key: "action:theme-system",
        label: "Follow the system theme",
        hint: "Drops the override and keeps following the operating system",
        run: () => setChoice("system"),
      },
      {
        kind: "action",
        key: "action:rail",
        label: settings.navExpanded ? "Collapse the navigation" : "Expand the navigation",
        hint: settings.navExpanded ? "Icons only, and 168px back for wide tables" : "Show the labels again",
        run: () => {
          const next = !settings.navExpanded;
          applyRail(next);
          update({ navExpanded: next });
        },
      },
    ],
    [resolved, setChoice, settings.navExpanded, update],
  );

  const results = useMemo<Result[]>(() => {
    const needle = query.trim().toLowerCase();

    const routes: Result[] = ROUTES.filter(
      (route) => needle === "" || `${route.label} ${route.hint}`.toLowerCase().includes(needle),
    ).map((route) => ({ kind: "route", key: `route:${route.href}`, ...route }));

    /*
     * Pins are shown only once there is something to match on, and capped at eight.
     *
     * An unfiltered registry would push the routes and the actions off the first screen, so the palette
     * would open on a list of pins for a reader who pressed ⌘K to get to Drift. Eight is what fits without
     * the list scrolling on a laptop; a ninth match is a signal to type one more character, which is
     * cheaper than a scroll.
     */
    const pins: Result[] =
      needle === ""
        ? []
        : snapshot.pins
            .filter((pin) => pinHaystack(pin).includes(needle))
            .slice(0, 8)
            .map((pin) => ({
              kind: "pin" as const,
              key: `pin:${pin.pinId}`,
              label: `${displayName(pin.skillName)}${pin.skillVersion === undefined ? "" : ` ${displayName(pin.skillVersion, "")}`}`,
              hint: `${pin.state} · ${shortAddress(pin.publisher)} · ${pin.capabilities.length} ${pin.capabilities.length === 1 ? "capability" : "capabilities"}`,
              href: `/pins?pin=${pin.pinId}`,
            }));

    const matchedActions = actions.filter(
      (action) => needle !== "" && `${action.label} ${action.hint}`.toLowerCase().includes(needle),
    );

    return [...routes, ...pins, ...matchedActions];
  }, [query, snapshot.pins, actions]);

  // Any change to the list invalidates the highlight, so it goes back to the top rather than out of range.
  useEffect(() => {
    setActive(0);
  }, [query]);

  const run = useCallback(
    (result: Result) => {
      close();
      if (result.kind === "action") result.run();
      else router.push(result.href);
    },
    [close, router],
  );

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(results.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = results[active];
      if (chosen !== undefined) run(chosen);
    }
  };

  const activeKey = results[active]?.key;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Meta+K Control+K"
        aria-label="Search and commands"
        title={mac === undefined ? "Search and commands" : `Search and commands (${mac ? "⌘K" : "Ctrl K"})`}
        className="press chunk flex h-8 shrink-0 items-center gap-2 rounded-md bg-panel px-2 text-muted hover:text-text sm:px-2.5"
      >
        <IconSearch />
        <span className="hidden text-note md:block">Search</span>
        {/*
          The shortcut, printed rather than only bound.

          A palette nobody knows the keystroke for is a button, and the whole value of following the ⌘K
          convention is that the reader stops using the button.
        */}
        <kbd className="hash hidden min-w-9 rounded bg-raise px-1.5 py-0.5 text-center text-label text-faint md:block">
          {mac === undefined ? "\u00a0" : mac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              aria-hidden
              onPointerDown={close}
              className="fixed inset-0 z-50 bg-[var(--scrim)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.15 }}
            />

            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Search and commands"
              className="fixed inset-x-4 top-[12vh] z-50 mx-auto w-auto max-w-xl overflow-hidden rounded-xl border border-line bg-bg sm:inset-x-0"
              initial={{ opacity: 0, y: reduced ? 0 : -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : -8 }}
              transition={{ duration: reduced ? 0 : 0.18 }}
            >
              <div className="flex items-center gap-2 border-b border-line px-3">
                <span className="text-faint">
                  <IconSearch />
                </span>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onInputKey}
                  role="combobox"
                  aria-expanded
                  aria-controls={listId}
                  aria-autocomplete="list"
                  {...(activeKey === undefined ? {} : { "aria-activedescendant": `${listId}-${activeKey}` })}
                  placeholder="Search pins, or jump to a page"
                  spellCheck={false}
                  autoComplete="off"
                  className="h-12 w-full bg-transparent text-note text-text outline-none placeholder:text-faint"
                />
              </div>

              <ul id={listId} role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto p-2">
                {results.length === 0 ? (
                  <li className="px-2 py-6 text-center text-note text-faint">
                    Nothing matches {'"'}
                    {query.trim()}
                    {'"'}. Pins are matched on name, version, hash and publisher.
                  </li>
                ) : (
                  results.map((result, index) => {
                    /*
                      The group header is drawn on the first result of each kind rather than by splitting the
                      list into three.

                      Splitting would mean three listboxes, and a listbox per group breaks arrow-key
                      traversal across the whole set — which is the one interaction a palette has to get
                      right. One flat list with headers inside it keeps a single index.
                    */
                    const first = index === 0 || results[index - 1]?.kind !== result.kind;

                    return (
                      <li key={result.key}>
                        {first ? (
                          <p className="shout px-2 pt-2 pb-1 text-label text-faint">{GROUP_LABEL[result.kind]}</p>
                        ) : null}

                        <div
                          id={`${listId}-${result.key}`}
                          role="option"
                          aria-selected={index === active}
                          onPointerMove={() => setActive(index)}
                          onClick={() => run(result)}
                          className={cx(
                            "flex cursor-pointer items-baseline gap-3 rounded-md px-2 py-2",
                            index === active ? "bg-raise text-text" : "text-muted",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-note leading-tight">{result.label}</span>
                            <span className="mt-0.5 block truncate text-label leading-tight text-faint">
                              {result.hint}
                            </span>
                          </span>
                          {index === active ? (
                            <span className="shout shrink-0 text-label text-faint">Enter</span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function IconSearch() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 20 20" />
    </svg>
  );
}
