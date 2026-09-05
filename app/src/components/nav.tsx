"use client";

/**
 * The left navigation rail.
 *
 * Moved from a top bar, and the visual language is the reason it works better here. Duolingo's own
 * navigation is a left rail with an icon and a heavy uppercase label per item, and a selected state
 * drawn as a tinted box with a matching border. A horizontal strip of seven of those either wraps or
 * forces the labels down to a size that fights the rest of the type.
 *
 * It also buys the thing this app actually needs: vertical space is cheap here and horizontal space
 * is not. The tables on /pins and /publishers are wide, and a 272px rail costs less than a 64px
 * header did, because the header was stealing from the scarce axis.
 *
 * The active indicator is a shared `layoutId`, so it slides between items rather than disappearing
 * and reappearing. Worth the complexity: the movement tells you where you came from, which a hard cut
 * does not, and in a vertical list the travel reads as position in a menu.
 *
 * Under `lg` the rail becomes a drawer behind a compact top bar, because a fixed 272px rail on a
 * 390px phone leaves 118px of content.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { WalletMenu } from "./wallet-menu";
import { AnimatePresence, SPRING_SOFT, motion, useReducedMotion } from "./motion";
import { ThemeToggle } from "./theme-toggle";
import { cx } from "./ui";

/*
 * Every item carries an outcome line as well as a label.
 *
 * Seven of the eight labels are coinages of this project -- pin, drift, bond, badge -- and mean nothing
 * on a first read. The quickstart already learned this lesson and titles its steps by outcome rather than
 * by destination; the nav is the primary wayfinding and was still naming features.
 *
 * Shown always in the mobile drawer, where there is room, and on hover or focus in the rail, where a
 * permanent second line would double the height of eight items to solve a problem a reader has once.
 */
const LINKS = [
  /*
   * `/dashboard`, not `/`. The rail points at the instrument, not at the pitch.
   *
   * This item used to be "Overview" on `/`, when that route was both the landing page and the dashboard.
   * The split gave each reader their own page, and the one holding a rail is by definition inside the
   * product -- putting the marketing page in their primary navigation would make them scroll past an
   * argument they have already accepted to reach the numbers.
   *
   * The landing page stays reachable: the Lockstep mark at the top of the rail links to it, in both the
   * drawer and the mobile bar, which is where a reader looks for a home link anyway.
   */
  { href: "/dashboard", label: "Dashboard", icon: IconHome, outcome: "Is anything wrong right now" },
  { href: "/pins", label: "Pins", icon: IconPin, outcome: "What each skill is allowed to do" },
  { href: "/drift", label: "Drift", icon: IconDrift, outcome: "What changed since you approved it" },
  { href: "/approvals", label: "Approvals", icon: IconCheck, outcome: "What your agent may spend under" },
  { href: "/publishers", label: "Publishers", icon: IconPublisher, outcome: "Who has money at stake" },
  { href: "/bonds", label: "Bonds", icon: IconCoins, outcome: "What a lie costs a publisher" },
  { href: "/badge", label: "Badge", icon: IconShield, outcome: "Show a pin in your README" },
  /*
   * Account last, and it carries settings with it rather than getting its own item.
   *
   * Seven was already a lot for a primary rail; nine would make it a list to scan rather than a menu.
   * Profile and settings answer the same question -- things about me, as opposed to things about the
   * registry -- so they are two sections of one route, reachable at /account#settings.
   */
  { href: "/account", label: "Account", icon: IconAccount, outcome: "Whether anything is enforcing it" },
] as const;


/**
 * The primary navigation, as a compact top bar.
 *
 * ## Why this replaced a 272px left rail
 *
 * The rail was chosen when the product was styled after Duolingo, whose own navigation is a left rail with
 * an icon and a heavy uppercase label per item. That reasoning was sound for that design and does not
 * survive it: the app is now a clinical, dense, data-first dashboard, and every convention in that category
 * puts navigation in a single thin bar across the top.
 *
 * It also cost more than it looked like it did. 272px is 17rem taken off every page at every width above
 * `lg`, on a product whose main content is wide tables of addresses and hashes -- the exact axis that was
 * already scarce. The rail's own justification claimed the opposite, that vertical space was the cheap one,
 * which was true of a page of stat cards and false of `/pins` and `/publishers`.
 *
 * ## What the bar carries, in the order a reader expects it
 *
 * Mark left, links beside it, account right. That is the layout of every wallet-connected dashboard a
 * reader has already used, and matching it means they do not have to learn where anything is. The account
 * control is a dropdown rather than a permanently expanded panel -- see `wallet-menu.tsx`.
 *
 * The outcome lines are gone from the links. They were a second line under each label, revealed on hover,
 * explaining what the destination answers; they earned their place in a rail where there was vertical room
 * and a reader was reading a menu. In a horizontal bar there is nowhere to put them that does not either
 * double the bar's height or cover the content below it. The words survive where they are still useful: as
 * `title`, so a hover or the accessibility tree still reaches them.
 *
 * Below `lg` the links collapse behind a menu button, and the account control stays visible. That split is
 * deliberate: on a phone the thing a reader most often wants from the chrome is their address and the
 * network, and burying it one tap deeper to keep the bar tidy would be tidiness winning over use.
 */
export function Nav() {
  const pathname = usePathname();
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

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-bg">
        <div className="gutter flex h-14 items-center gap-2">
          <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md py-1">
            <Mark />
            <span className="font-display text-base tracking-tight text-text">Lockstep</span>
          </Link>

          {/*
            The links, from `md` up.

            Text only, no icons. The icon set was drawn for a rail where each item had a 20px glyph and a
            label on its own line; at 13px inline the glyphs stop being legible and start being noise beside
            the word they duplicate. They are still used for the mobile sheet, where the vertical layout is
            the one they were designed for.
          */}
          <nav aria-label="Primary" className="ml-2 hidden min-w-0 md:block">
            <ul className="flex items-center gap-0.5">
              {LINKS.map((link) => {
                const active = isActive(link.href);
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      title={link.outcome}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "relative block rounded-md px-2.5 py-1.5 text-note whitespace-nowrap transition-colors",
                        active ? "text-text" : "text-muted hover:bg-raise hover:text-text",
                      )}
                    >
                      {active ? (
                        <motion.span
                          layoutId="nav-active"
                          transition={SPRING_SOFT}
                          className="absolute inset-0 rounded-md bg-raise"
                        />
                      ) : null}
                      <span className="relative">{link.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <WalletMenu />
            <span className="hidden sm:block">
              <ThemeToggle />
            </span>

            {/* The menu button, below `md`, where the links do not fit. */}
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-controls="nav-sheet"
              aria-label="Open menu"
              className="press chunk grid size-9 place-items-center rounded-md bg-panel text-muted md:hidden"
            >
              <span aria-hidden className="grid gap-[3px]">
                <span className="block h-[2px] w-4 rounded-pill bg-current" />
                <span className="block h-[2px] w-4 rounded-pill bg-current" />
                <span className="block h-[2px] w-4 rounded-pill bg-current" />
              </span>
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open ? (
          <>
            <motion.button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-[var(--scrim)] md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            />

            <motion.div
              id="nav-sheet"
              className="fixed inset-x-0 top-0 z-50 border-b border-line bg-bg md:hidden"
              initial={{ y: "-100%" }}
              animate={{ y: 0 }}
              exit={{ y: "-100%" }}
              transition={SPRING_SOFT}
            >
              <div className="gutter py-3">
                <div className="flex h-8 items-center justify-between">
                  <span className="shout text-label text-faint">Menu</span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="press rounded-md px-2 py-1 text-note text-muted hover:text-text"
                  >
                    Close
                  </button>
                </div>

                <ul className="mt-2 grid gap-0.5">
                  {LINKS.map((link) => {
                    const active = isActive(link.href);
                    const Icon = link.icon;
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
                          <span className="grid place-items-center">
                            <Icon heavy={active} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-note">{link.label}</span>
                            {/* Room for the outcome line here, which is where it always read best. */}
                            <span className="block truncate text-label text-faint">{link.outcome}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-3 border-t border-line pt-3 sm:hidden">
                  <ThemeToggle />
                </div>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}


/*
 * Thick strokes, round joins, no fills.
 *
 * 2.5 at 20px, which matches the weight of the 2px borders and the mascot's outline. A 1.5-stroke
 * icon set beside 800-weight uppercase labels looks like it was borrowed from another product, and
 * that mismatch is the most common way a Duolingo-adjacent interface falls apart.
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
 * the nav ends up mixing styles — which is the thing this comment already warns about below. One set,
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
 * A key, for the account.
 *
 * Not the usual head-and-shoulders silhouette, which would be wrong here in a way worth naming: the
 * account is not a person, it is a keypair. `IconPublisher` already uses the person glyph for the
 * thing that genuinely is an actor with a reputation, and reusing it would collapse a distinction the
 * rest of the app is careful about.
 */
function IconAccount({ heavy = false }: { heavy?: boolean }) {
  return (
    <Glyph heavy={heavy}>
      <circle cx="8.5" cy="8.5" r="4" />
      <path d="M11.4 11.6 20 20.5" />
      <path d="M16.5 17 14.5 19" />
    </Glyph>
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