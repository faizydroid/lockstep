"use client";

/**
 * The primary navigation: a full-height left rail, and a slim bar across the content beside it.
 *
 * ## Why this is a rail again
 *
 * It was a rail, then a 56px top bar, and now a rail with a top bar. The reversal is not indecision; the
 * first two shapes were each argued from one half of the evidence.
 *
 * The rule that settles it, and which both earlier versions were missing: a sidebar is for a product with
 * many sections, a top bar is for a product with three to six, and mature products run both -- the bar for
 * global context, the rail for primary navigation. This app has seven primary areas. A horizontal strip of
 * seven coined nouns is a list to read, not a menu to use, and it has nowhere to put the words that explain
 * what "drift" and "pin" mean. Eye-tracking puts six items in three fixations vertically against three
 * horizontally, which is the same finding from the other direction.
 *
 * The top-bar version was right about one thing and it is kept: 272px off every page is too much on a
 * product whose main content is wide tables of addresses. So the rail collapses to 56px, the choice
 * persists, and the reader who opens `/pins` can have their horizontal axis back without losing wayfinding.
 * The bar keeps only what is genuinely global -- the network, the wallet, the theme -- which is what a bar
 * is for.
 *
 * ## What the rail carries, and what left
 *
 * Seven links in four groups, because seven flat items is a list and four labelled groups of one to three
 * is a menu. The groups also draw the distinction the app cares about: things about your agent, things
 * about the registry, and a tool.
 *
 * Account is gone from the navigation entirely. Its facts -- address, network, whether anything is
 * enforcing -- now live in the wallet menu at the top right, which is where every wallet-connected
 * dashboard puts them and where a reader looks first. Keeping a nav item pointing at the same information
 * would be two front doors to one room.
 *
 * Drift carries a count when something needs a decision. That is the one piece of state worth promoting
 * into the chrome: it turns the rail into a work queue, so "is anything wrong" is answered before the
 * reader clicks anything. It is drawn from the same `widened` derivation `/drift` leads with, so the badge
 * and the page cannot disagree.
 *
 * The outcome lines are back as visible text rather than `title`. They were dropped when the bar had
 * nowhere to put a second line; a rail does. They are the fix for the actual problem with these labels,
 * which is that six of the seven are coinages of this project and mean nothing on a first read.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { applyRail } from "@/lib/rail";

import { CommandPalette } from "./command-palette";
import { useCertainty, useSnapshot } from "./data";
import { WalletMenu } from "./wallet-menu";
import { AnimatePresence, SPRING_SOFT, motion } from "./motion";
import { useSettings } from "./settings";
import { ThemeToggle } from "./theme-toggle";
import { cx } from "./ui";

interface NavLink {
  readonly href: string;
  readonly label: string;
  readonly icon: (props: { heavy?: boolean }) => ReactNode;
  readonly outcome: string;
}

interface NavGroup {
  /** Absent for the first group, which is one item and needs no header above it. */
  readonly label?: string;
  readonly links: readonly NavLink[];
}

/*
 * Four groups, and the headers are the point rather than decoration.
 *
 * Seven items with no structure is scanned linearly, which is the failure mode a rail is supposed to avoid.
 * Grouped, the reader answers a cheaper question first -- is this about my agent or about the registry --
 * and then picks from two or three.
 *
 * `/dashboard`, not `/`. The rail points at the instrument, not at the pitch: a reader holding a rail is by
 * definition inside the product, and putting the marketing page in their primary navigation would make them
 * scroll past an argument they have already accepted to reach the numbers. The landing page stays reachable
 * from the mark at the top of the rail, which is where a reader looks for a home link anyway.
 */
const GROUPS: readonly NavGroup[] = [
  {
    links: [{ href: "/dashboard", label: "Dashboard", icon: IconHome, outcome: "Is anything wrong right now" }],
  },
  {
    /*
     * "Your agent", not "Needs you".
     *
     * Only Drift needs anyone. Approvals is a record of what the account already decided plus one narrowing
     * write, and filing it under a header that promises a queue would overstate it every time the queue is
     * empty. The urgency lives on the badge, which is honest because it counts something.
     */
    label: "Your agent",
    links: [
      { href: "/drift", label: "Drift", icon: IconDrift, outcome: "What changed since you approved it" },
      { href: "/approvals", label: "Approvals", icon: IconCheck, outcome: "What your agent may spend under" },
    ],
  },
  {
    label: "The registry",
    links: [
      { href: "/pins", label: "Pins", icon: IconPin, outcome: "What each skill is allowed to do" },
      { href: "/publishers", label: "Publishers", icon: IconPublisher, outcome: "Who has money at stake" },
      { href: "/bonds", label: "Bonds", icon: IconCoins, outcome: "What a lie costs a publisher" },
    ],
  },
  {
    label: "Tools",
    links: [{ href: "/badge", label: "Badge", icon: IconShield, outcome: "Show a pin in your README" }],
  },
];

/** Flattened, for the mobile sheet and for anything that wants the set rather than the structure. */
const LINKS: readonly NavLink[] = GROUPS.flatMap((group) => group.links);

/**
 * The rail's foot: things about the reader rather than about the registry.
 *
 * Separate from `GROUPS` rather than a fifth group, because they are pinned to the bottom of the rail and a
 * group is something that scrolls with the list above it. `highlight` exists because `/account#settings` is a
 * tab inside `/account` and `usePathname` cannot see a hash, so a prefix test would mark both rows current.
 */
const SECONDARY: readonly (NavLink & { readonly highlight: boolean })[] = [
  {
    href: "/account",
    label: "Account",
    icon: IconKey,
    outcome: "Whether anything is enforcing it",
    highlight: true,
  },
  {
    href: "/account#settings",
    label: "Settings",
    icon: IconSliders,
    outcome: "RPC endpoint, account, motion",
    highlight: false,
  },
];

/*
 * The three that get a tab of their own on a phone, in order.
 *
 * Referenced by href and resolved against `LINKS` rather than duplicated, so a label or an outcome line is
 * edited in one place. Three plus an overflow item is four targets, which is inside the three-to-five range
 * every platform guideline gives and leaves each one comfortably wider than a fingertip.
 *
 * These three are the questions a reader opens the app to answer: is anything wrong, what changed, and what
 * is a skill allowed to do. Bonds and Badge are things you do once; Approvals is a record you consult.
 */
const TAB_HREFS: readonly string[] = ["/dashboard", "/drift", "/pins"];

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
}

/**
 * How many drifted skills actually need a person.
 *
 * `widened` rather than `drifted.length`, matching what `/drift` leads with. A release that only removes
 * capabilities or lowers its ceiling has changed and does not need a decision, and badging it would train
 * the reader to ignore the badge -- which is the failure every notification count eventually has.
 *
 * Returns 0 while the read is in flight. During that window the snapshot is still the seeded fixture, so a
 * badge drawn from it is a number about sample data wearing the appearance of an alert about this account.
 */
function useNeedsDecision(): number {
  const { snapshot } = useSnapshot();
  const certainty = useCertainty();
  if (certainty === "reading") return 0;
  return snapshot.drifted.filter((skill) => skill.diff.widened).length;
}

/** Reads the persisted rail state and writes it back, keeping the DOM attribute in step. */
function useRail() {
  const { settings, update } = useSettings();
  return {
    expanded: settings.navExpanded,
    toggle: () => {
      const next = !settings.navExpanded;
      /*
       * The attribute is set here as well as persisted, because the persisted value is only read by the
       * blocking script on the next load. Without this call the rail would not move until a reload.
       */
      applyRail(next);
      update({ navExpanded: next });
    },
  };
}

/**
 * The rail. Fixed, full height, hidden below `lg`.
 *
 * Out of flow deliberately: it must not scroll with the page, and the content column offsets itself by
 * `--rail` rather than sitting in a grid, so a page can still run full-bleed to the right edge.
 *
 * Below `lg` there is no rail at all. A fixed 224px sidebar on a 390px phone leaves 166px of content, so
 * the links move into a sheet behind the bar's menu button.
 */
export function Rail() {
  const isActive = useIsActive();
  const { expanded } = useRail();
  const needsDecision = useNeedsDecision();

  return (
    <div
      className="fixed inset-y-0 left-0 z-40 hidden w-[var(--rail)] flex-col border-r border-line bg-bg lg:flex"
      /*
       * The width transition is on the container, not on each item.
       *
       * Animating seven items independently means seven elements whose text reflows at slightly different
       * moments, which reads as the rail tearing. One transition on the box, with the labels simply
       * clipped by `overflow-hidden`, reads as a panel sliding.
       */
      style={{ transition: "width 180ms ease" }}
    >
      <div className={cx("flex h-14 shrink-0 items-center border-b border-line", expanded ? "px-3" : "px-2")}>
        <Link
          href="/"
          className="flex min-w-0 shrink-0 items-center gap-2 rounded-md py-1"
          title="Lockstep — back to the front page"
        >
          <Mark />
          {expanded ? (
            <span className="font-display truncate text-base tracking-tight text-text">Lockstep</span>
          ) : null}
        </Link>
      </div>

      <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-3">
        {GROUPS.map((group, index) => (
          <div key={group.label ?? "overview"} className={index === 0 ? undefined : "mt-4"}>
            {/*
              The group header, expanded only.

              Collapsed there is no room for a word, and an abbreviation nobody agreed on would be worse
              than the rule that survives without it: the groups are still separated by the gap above.
            */}
            {group.label === undefined ? null : (
              <p className={cx("shout px-3 pb-1 text-label text-faint", expanded ? "block" : "sr-only")}>
                {group.label}
              </p>
            )}

            <ul className="grid gap-0.5 px-2">
              {group.links.map((link) => {
                const active = isActive(link.href);
                const count = link.href === "/drift" ? needsDecision : 0;

                return (
                  <li key={link.href}>
                    <RailItem link={link} expanded={expanded} active={active} count={count} />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/*
        The foot of the rail: the account, its settings, and the theme.

        ## Why these three and why down here
        
        All three are things a reader touches rarely and then wants to find without hunting. Every product in
        this category puts them at the bottom of the sidebar for that reason, and the position carries meaning
        on its own: separated from the primary nav by a rule and pinned below it, they read as being about the
        reader rather than about the registry.

        Account was briefly not in the navigation at all -- its facts had moved into the wallet menu, and a nav
        item pointing at the same information looked like two front doors to one room. That was half right. The
        menu is the right place for the *facts* of the connected wallet, which is what a chevron next to an
        address promises. It is the wrong place to keep a page, because a page reached only through a dropdown
        is a page a keyboard reader has to know exists. Both now point at `/account`, and that is not a
        duplicate: one is a summary in the chrome, the other is a route in the navigation.

        The theme control lives here rather than in the top bar because it is appearance, not context. The bar
        carries what decides whether the figures on screen mean anything -- the network and the wallet -- and a
        light/dark switch beside those was three icons of nothing competing with them.
      */}
      <div className={cx("shrink-0 border-t border-line py-2", expanded ? "px-2" : "px-2")}>
        <ul className="grid gap-0.5">
          {SECONDARY.map((link) => (
            <li key={link.label}>
              <RailItem
                link={link}
                expanded={expanded}
                /*
                  Only Account highlights. `/account#settings` is a tab inside the same route, and
                  `usePathname` cannot see a hash -- so a `startsWith` test would light both rows at once and
                  claim the reader is in two places.
                */
                active={link.highlight && isActive("/account")}
                count={0}
              />
            </li>
          ))}
        </ul>

        <div className={cx("mt-2 flex border-t border-line pt-2", expanded ? "px-2.5" : "justify-center")}>
          {/* Stacked when collapsed: three 24px targets in a row do not fit inside 56px. */}
          <ThemeToggle stack={!expanded} />
        </div>
      </div>
    </div>
  );
}

/**
 * One row of the rail, used by the primary groups and by the foot.
 *
 * Extracted when the foot was added, rather than the foot growing its own markup. Two nearly-identical
 * forty-line blocks is how a rail ends up with rows that are two pixels apart and a selected state that
 * only animates in one of them.
 */
function RailItem({
  link,
  expanded,
  active,
  count,
}: {
  link: NavLink;
  expanded: boolean;
  active: boolean;
  count: number;
}) {
  const Icon = link.icon;

  return (
    <Link
      href={link.href}
      // The tooltip is the only label when the rail is collapsed, so it carries both halves.
      title={expanded ? link.outcome : `${link.label} — ${link.outcome}`}
      aria-current={active ? "page" : undefined}
      className={cx(
        "relative flex items-center gap-2 rounded-md transition-colors",
        expanded ? "px-2.5 py-2" : "justify-center px-0 py-2",
        active ? "text-text" : "text-muted hover:text-text",
      )}
    >
      {active ? (
        <motion.span
          layoutId="nav-active"
          transition={SPRING_SOFT}
          className="absolute inset-0 rounded-md bg-raise"
        />
      ) : null}

      <span className="relative grid shrink-0 place-items-center">
        <Icon heavy={active} />
      </span>

      {expanded ? (
        <span className="relative min-w-0 flex-1">
          <span className="block truncate text-note leading-tight">{link.label}</span>
          {/*
            The outcome line, and the reason the rail is worth its width.

            Six of the seven primary labels are words this project invented. A permanent second line costs
            14px per item in a column that has hundreds to spare, and it is the difference between a menu a
            first-time reader can use and one they have to click through to decode.
          */}
          <span className="mt-0.5 block truncate text-label leading-tight text-faint">{link.outcome}</span>
        </span>
      ) : (
        <span className="sr-only">
          {link.label}. {link.outcome}
        </span>
      )}

      {count > 0 ? <Badge count={count} compact={!expanded} /> : null}
    </Link>
  );
}

/**
 * The count on Drift.
 *
 * Amber rather than red. Red is spent in this app on `revoked` and `slashed` -- states that are final --
 * and drift is a decision waiting, not a loss taken. Also carries a word for a screen reader, because a
 * number alone announces "3" and leaves the listener to guess what three of.
 */
function Badge({ count, compact }: { count: number; compact: boolean }) {
  return (
    <span
      className={cx(
        "shout grid place-items-center rounded-pill bg-attention text-label text-on-face",
        /*
          Two positionings, not one with an override.
          
          Collapsed, the badge sits on the icon's top-right corner because there is no row left to sit at
          the end of. Expanded it is a normal end-of-row element. Emitting `relative` and `absolute`
          together and letting the cascade choose is how a badge ends up in the corner of the page.
        */
        compact ? "absolute top-1 right-1 size-4" : "relative ml-auto h-5 min-w-5 px-1.5",
      )}
    >
      <span aria-hidden>{count}</span>
      <span className="sr-only">
        {count} {count === 1 ? "skill needs" : "skills need"} your decision
      </span>
    </span>
  );
}

/**
 * The bar across the top of the content column.
 *
 * Everything global and nothing local. At `lg` and up the mark and the links are in the rail, so the left
 * slot carries the rail's collapse toggle -- which is where Linear and Notion put theirs, next to the
 * content rather than inside the panel it controls, so it is in the same place whether the panel is open
 * or shut. Below `lg` the left slot carries the mark and the right gains a menu button.
 *
 * The network is stated here rather than only behind the wallet chevron. Chain context decides what every
 * figure on the page means, and a reader who has not connected anything still needs to know which chain
 * they are reading -- which the wallet menu, by definition, cannot tell them.
 */
export function NavBar() {
  const { expanded, toggle } = useRail();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg">
      <div className="gutter flex h-14 items-center gap-2">
        {/* The mark, below `lg` only. Above it, the rail already has one and two would be a duplicate. */}
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md py-1 lg:hidden">
          <Mark />
          <span className="font-display text-base tracking-tight text-text">Lockstep</span>
        </Link>

        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse the navigation labels" : "Expand the navigation labels"}
          title={expanded ? "Collapse the navigation" : "Expand the navigation"}
          className="press hidden size-8 place-items-center rounded-md text-faint hover:bg-raise hover:text-text lg:grid"
        >
          <IconPanel open={expanded} />
        </button>

        {/*
          The palette, next to the rail toggle rather than out on the right.

          Left-of-centre is where every product that ships one puts it, because it belongs to the content
          rather than to the account. The right-hand cluster is identity and appearance; putting a search
          control in it would make the reader hunt for it among things that are not search.
        */}
        <CommandPalette />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <NetworkChip />
          <WalletMenu />
          {/*
            The theme control, only where there is no rail to put it in.

            It moved to the foot of the rail, which is where this category puts appearance settings and where it
            stops competing with the two things in this bar that decide whether the figures on screen mean
            anything. Below `lg` there is no rail, so the bar keeps it; below `sm` the bar is too narrow and the
            overflow sheet keeps it instead.
          */}
          <span className="hidden sm:block lg:hidden">
            <ThemeToggle />
          </span>
        </div>
      </div>
    </header>
  );
}

/**
 * Below `lg`: a bottom tab bar, with everything else behind one overflow item.
 *
 * ## Why the bottom, and why four
 *
 * The hamburger this replaces put every destination two taps away and both of them at the top of the
 * screen, which is the hardest place to reach one-handed on a phone. A tab bar is one tap, in the thumb
 * zone, and it shows where you are without being opened. Three to five items is the ceiling in every
 * platform guideline for the same reason: past five the targets are closer together than a fingertip is
 * wide. Each one is at least 44px, which is what a fingertip actually covers.
 *
 * Dashboard, Drift and Pins are the three, chosen as the three questions a reader opens this app to answer:
 * is anything wrong, what changed, and what is a skill allowed to do. Approvals, Publishers, Bonds and
 * Badge are behind "More", which opens the full grouped list — so nothing is unreachable and nothing common
 * costs two taps.
 *
 * The icons keep their labels. An icon-only tab bar is a memory test, and these are project coinages: a
 * reader cannot deduce "drift" from a glyph they have never seen attached to the word.
 */
export function MobileTabs() {
  const isActive = useIsActive();
  const needsDecision = useNeedsDecision();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const tabs = TAB_HREFS.map((href) => LINKS.find((link) => link.href === href)).filter(
    (link): link is NavLink => link !== undefined,
  );

  return (
    <>
      {/*
        `pb-[env(safe-area-inset-bottom)]` is not cosmetic. Without it the row sits under the iOS home
        indicator, so the bottom third of every target is a gesture area rather than a button.
      */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="grid grid-cols-4">
          {tabs.map((link) => {
            const active = isActive(link.href);
            const Icon = link.icon;
            const count = link.href === "/drift" ? needsDecision : 0;

            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 py-2",
                    active ? "text-text" : "text-faint",
                  )}
                >
                  <Icon heavy={active} />
                  <span className="text-label leading-none">{link.label}</span>
                  {count > 0 ? <Badge count={count} compact /> : null}
                </Link>
              </li>
            );
          })}

          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-controls="nav-sheet"
              className={cx(
                "flex min-h-[44px] w-full flex-col items-center justify-center gap-0.5 px-1 py-2",
                open ? "text-text" : "text-faint",
              )}
            >
              <IconMore />
              <span className="text-label leading-none">More</span>
            </button>
          </li>
        </ul>
      </nav>

      {/*
        The overflow sheet. Comes up from the bottom now, because that is where the button that opens it is.

        A sheet that drops from the top while the finger is at the bottom of the screen makes the reader
        move their hand to a menu they just asked for from where their hand already was.
      */}
      <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-[var(--scrim)] lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />

          <motion.nav
            id="nav-sheet"
            aria-label="All sections"
            className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-xl border-t border-line bg-bg pb-[env(safe-area-inset-bottom)] lg:hidden"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={SPRING_SOFT}
          >
            <div className="gutter py-3">
              <div className="flex h-8 items-center justify-between">
                <span className="shout text-label text-faint">All sections</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="press rounded-md px-2 py-1 text-note text-muted hover:text-text"
                >
                  Close
                </button>
              </div>

              {/*
                Grouped here too, and with the headers visible.

                A sheet has the room a collapsed rail does not, and a reader who opened a menu is reading
                rather than glancing -- which is exactly when the structure earns its two lines.
              */}
              {GROUPS.map((group, index) => (
                <div key={group.label ?? "overview"} className={index === 0 ? "mt-2" : "mt-3"}>
                  {group.label === undefined ? null : (
                    <p className="shout px-2 pb-1 text-label text-faint">{group.label}</p>
                  )}

                  <ul className="grid gap-0.5">
                    {group.links.map((link) => {
                      const active = isActive(link.href);
                      const Icon = link.icon;
                      const count = link.href === "/drift" ? needsDecision : 0;

                      return (
                        <li key={link.href}>
                          <Link
                            href={link.href}
                            onClick={() => setOpen(false)}
                            aria-current={active ? "page" : undefined}
                            className={cx(
                              "flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors",
                              active ? "bg-raise text-text" : "text-muted hover:text-text",
                            )}
                          >
                            <span className="grid shrink-0 place-items-center">
                              <Icon heavy={active} />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-note">{link.label}</span>
                              <span className="block truncate text-label text-faint">{link.outcome}</span>
                            </span>
                            {count > 0 ? <Badge count={count} compact={false} /> : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}

              {/*
                Account and Settings, which have no tab of their own.

                They are the rail's foot on a wide screen. Here they are the last group in the sheet, which is
                the same position for the same reason -- and without them a phone reader could reach neither,
                since four tabs is the ceiling and both of these lost that competition to Drift and Pins.
              */}
              <div className="mt-3 border-t border-line pt-3">
                <ul className="grid gap-0.5">
                  {SECONDARY.map((link) => {
                    const Icon = link.icon;
                    const active = link.highlight && isActive("/account");

                    return (
                      <li key={link.label}>
                        <Link
                          href={link.href}
                          onClick={() => setOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={cx(
                            "flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors",
                            active ? "bg-raise text-text" : "text-muted hover:text-text",
                          )}
                        >
                          <span className="grid shrink-0 place-items-center">
                            <Icon heavy={active} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-note">{link.label}</span>
                            <span className="block truncate text-label text-faint">{link.outcome}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="mt-3 border-t border-line pt-3 sm:hidden">
                <ThemeToggle />
              </div>
            </div>
          </motion.nav>
        </>
      ) : null}
    </AnimatePresence>
    </>
  );
}

/**
 * Which chain the figures on screen came from.
 *
 * Deliberately not a switcher. There is one deployment and the app reads it whether a wallet is connected
 * or not, so a dropdown offering chains that hold no registry would be a control whose only outcome is an
 * empty page. When the connected wallet is on a different chain the wallet menu takes over the whole
 * button, which is the louder signal that belongs to that state.
 */
function NetworkChip() {
  const certainty = useCertainty();

  return (
    <span
      className="chunk hidden items-center gap-1.5 rounded-pill bg-panel px-2.5 py-1 md:inline-flex"
      title={
        certainty === "chain"
          ? "Figures on this page were read from Monad testnet"
          : certainty === "reading"
            ? "Reading Monad testnet now"
            : "No registry is configured, so the figures are worked examples"
      }
    >
      <span
        aria-hidden
        className={cx(
          "block size-1.5 rounded-pill",
          certainty === "chain" ? "bg-bonded" : certainty === "reading" ? "bg-pinned" : "bg-attention",
        )}
      />
      <span className="shout text-label text-muted">
        Monad testnet
        {/*
          The state as a word, not only as the colour of the dot beside it.

          The dot was doing the whole job: green read, blue reading, amber sample. A reader who cannot
          distinguish those hues got one chip that never changed, and this is not decoration -- it is whether
          the figures on the page are a reading of a deployment or a worked example. The title carried it,
          which is a hover, which is not an answer on a phone.
        */}
        {certainty === "chain" ? null : (
          <span className={certainty === "reading" ? "text-faint" : "text-attention-ink"}>
            {" \u00b7 "}
            {certainty === "reading" ? "reading" : "sample"}
          </span>
        )}
      </span>
    </span>
  );
}

/*
 * There is no single `Nav` export any more, and that is a structural consequence rather than a tidy-up.
 *
 * The rail is `fixed`, so it must be mounted outside the column that offsets itself against it; the bar is
 * `sticky`, so it must be mounted inside that column or it spans underneath the rail. One component cannot
 * be in two places, so `chrome.tsx` mounts `Rail` and `NavBar` on either side of the wrapper.
 */

/*
 * Thick strokes, round joins, no fills.
 *
 * 2.5 at 20px, which matches the weight of the 2px borders and the mascot's outline. A 1.5-stroke
 * icon set beside heavier labels looks like it was borrowed from another product, and that mismatch
 * is the most common way an interface falls apart at the seams.
 */
/**
 * @param heavy Selected state. Draws the same path at 3.2 instead of 2.5.
 *
 * The active item previously changed colour and gained a tinted box, and kept an identical icon.
 * That is what the default iOS tab bar does, and it is the one place a nav can carry a little more
 * signal for free: a selected icon that is visibly heavier reads as pressed rather than merely
 * highlighted, and the eye finds it before it reads the label.
 *
 * Weight and not a filled variant, deliberately. Filling these would mean a second set of thirty-odd
 * paths to keep in step with the first, and the failure mode of two icon sets is that they drift and
 * the nav ends up mixing styles — which is the thing this comment already warns about above. One set,
 * two weights, nothing to keep synchronised.
 */
function Glyph({ children, heavy = false }: { children: ReactNode; heavy?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-[19px] transition-[stroke-width] duration-200"
      fill="none"
      stroke="currentColor"
      strokeWidth={heavy ? 3.2 : 2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function IconHome({ heavy = false }: { heavy?: boolean }) {
  return (
    <Glyph heavy={heavy}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10.5V20h12v-9.5" />
    </Glyph>
  );
}

/** A pin, for pinned versions. */
function IconPin({ heavy = false }: { heavy?: boolean }) {
  return (
    <Glyph heavy={heavy}>
      <path d="M12 21v-6" />
      <path d="M8 5h8l-1.5 6.5h-5L8 5Z" />
      <path d="M9 5h6" />
    </Glyph>
  );
}

/** Two paths that share an origin and diverge: drift, literally. */
function IconDrift({ heavy = false }: { heavy?: boolean }) {
  return (
    <Glyph heavy={heavy}>
      <path d="M4 12h5" />
      <path d="M9 12c4 0 4-6 11-6" />
      <path d="M9 12c4 0 4 6 11 6" />
      <path d="M17 3.5 20.5 6 17 8.5" />
      <path d="M17 15.5 20.5 18 17 20.5" />
    </Glyph>
  );
}

function IconCheck({ heavy = false }: { heavy?: boolean }) {
  return (
    <Glyph heavy={heavy}>
      <path d="M20 6.5 10 17l-5.5-5" />
    </Glyph>
  );
}

function IconPublisher({ heavy = false }: { heavy?: boolean }) {
  return (
    <Glyph heavy={heavy}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" />
    </Glyph>
  );
}

/** Stacked coins, for bonds. */
function IconCoins({ heavy = false }: { heavy?: boolean }) {
  return (
    <Glyph heavy={heavy}>
      <ellipse cx="12" cy="6.5" rx="7" ry="2.8" />
      <path d="M5 6.5v5c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-5" />
      <path d="M5 11.5v5c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-5" />
    </Glyph>
  );
}

function IconShield({ heavy = false }: { heavy?: boolean }) {
  return (
    <Glyph heavy={heavy}>
      <path d="M12 3.5 19 6v6c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V6l7-2.5Z" />
    </Glyph>
  );
}

/**
 * A key, for the account. Deleted with the old Account nav item and back with the new one.
 *
 * Not the usual head-and-shoulders silhouette, which would be wrong here in a way worth naming: the account
 * is not a person, it is a keypair. `IconPublisher` already uses the person glyph for the thing that genuinely
 * is an actor with a reputation, and reusing it would collapse a distinction the rest of the app is careful
 * about.
 */
function IconKey({ heavy = false }: { heavy?: boolean }) {
  return (
    <Glyph heavy={heavy}>
      <circle cx="8.5" cy="8.5" r="4" />
      <path d="M11.4 11.6 20 20.5" />
      <path d="M16.5 17 14.5 19" />
    </Glyph>
  );
}

/**
 * Three sliders, for settings.
 *
 * Not a cog. Every cog in every interface means "settings", which is the problem: this route's settings are
 * four specific values a reader adjusts -- an RPC endpoint, an account to read, a start block, a motion
 * preference -- and sliders say "things you tune" where a cog says "the machinery". At 19px a cog also loses
 * its teeth and reads as a smudged circle, which the shield glyph is already close to.
 */
function IconSliders({ heavy = false }: { heavy?: boolean }) {
  return (
    <Glyph heavy={heavy}>
      <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h10M18 17h2" />
      <circle cx="16" cy="7" r="0.1" />
      <circle cx="10" cy="12" r="0.1" />
      <circle cx="16" cy="17" r="0.1" />
    </Glyph>
  );
}

/**
 * A panel with its edge marked: the rail's collapse toggle.
 *
 * The bar inside the rectangle moves rather than the whole glyph flipping, because the two states are the
 * same panel at two widths and the icon should say that. An arrow would say "go somewhere", which is what
 * every other control in this bar does.
 */
/**
 * Three dots, for the overflow tab.
 *
 * Horizontal rather than vertical: vertical dots mean "actions on this item" everywhere else on the web, and
 * this is not an item, it is more of the same list.
 */
function IconMore() {
  return (
    <Glyph>
      <circle cx="5.5" cy="12" r="0.1" />
      <circle cx="12" cy="12" r="0.1" />
      <circle cx="18.5" cy="12" r="0.1" />
    </Glyph>
  );
}

function IconPanel({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d={open ? "M10 4v16" : "M7 4v16"} />
    </svg>
  );
}

/**
 * The mark: two rounded bars locked at an offset.
 *
 * Reads as a step, which is the whole idea -- the version that runs moves in lockstep with the
 * version that was approved. The bars nudge into alignment on hover, which is the joke made
 * literal.
 */
export function Mark() {
  return (
    <motion.span
      aria-hidden
      initial="rest"
      whileHover="locked"
      className="pop-sm grid size-9 shrink-0 place-items-center rounded-lg bg-panel"
    >
      <svg viewBox="0 0 24 24" className="size-[20px]">
        {/*
          Stroked in --on-face at 1.5, matching the mascot's outline, so the mark and the character
          read as the same drawing system rather than two unrelated pieces of art.
        */}
        <motion.rect
          width="12"
          height="6"
          rx="3"
          fill="var(--bonded)"
          stroke="var(--on-face)"
          strokeWidth="1.5"
          variants={{ rest: { x: 3, y: 4.5 }, locked: { x: 6, y: 4.5 } }}
          transition={SPRING_SOFT}
        />
        <motion.rect
          width="12"
          height="6"
          rx="3"
          fill="var(--pinned)"
          stroke="var(--on-face)"
          strokeWidth="1.5"
          variants={{ rest: { x: 9, y: 13.5 }, locked: { x: 6, y: 13.5 } }}
          transition={SPRING_SOFT}
        />
      </svg>
    </motion.span>
  );
}
