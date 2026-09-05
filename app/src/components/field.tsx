/**
 * The background: a single static dot grid, and nothing else.
 *
 * ## What this used to be
 *
 * A drifting diagonal lattice, three coloured radial pools carrying the theme's "temperature", two
 * animated gradient bars at wall scale reprising the product's logo motif, and a grain overlay. All of it
 * fixed behind every page, including the data tables.
 *
 * ## Why almost all of it is gone
 *
 * The colour pools are the part with a principled argument against them rather than a matter of taste.
 * This interface spends its whole length making colour mean something specific -- green is bonded, blue is
 * pinned, amber wants attention, red was refused -- and every status pill, ring and badge depends on that
 * being reliable. Washing all three of those hues across the full height of every page directly
 * undermines it: when the page is already green and blue, a green pill is no longer information. The
 * background was competing with the one signalling system the product cannot afford to weaken.
 *
 * The motion went for a simpler reason. A lattice drifting under a table of hashes a reader is comparing
 * character by character is movement with no message, and this file's own comment used to argue it was
 * "slow enough that it never competes with content" -- which is an argument for it being invisible, not
 * for it being there.
 *
 * What survives is a static, hueless dot grid at low opacity. It gives large flat areas some texture so
 * they do not band on cheap panels, which was the grain pass's actual job, and it does that without
 * moving, without colour, and without a second element.
 *
 * No longer a client component: there is nothing to animate, so there is nothing to opt out of under
 * reduced motion either.
 */

export function Field() {
  return (
    <div
      aria-hidden
      /*
       * `fixed` and behind everything, so it never scrolls and never takes a pointer event.
       *
       * Drawn with a background-image rather than an inline SVG: a repeating radial gradient is one paint
       * with no element tree.
       *
       * ## Why it is fainter and sparser than it was
       *
       * The first flat version used `--line-strong` at 0.35 on a 22px pitch, which was still legible as a
       * pattern rather than as texture -- a visible speckle behind pages full of hashes a reader is meant
       * to compare character by character. Reported as noise, and correctly.
       *
       * Three changes. `--line` rather than `--line-strong`, so the dot is the same value as a hairline
       * border rather than the emphasis value. Opacity down to 0.5 of that. And a 28px pitch, which is
       * about a third fewer dots per unit area. The intent was only ever to stop large flat fills banding
       * on cheap panels, and that does not need to be seen to work.
       *
       * It renders inside the theme scope via `components/chrome.tsx`, which is what keeps the dot the
       * right value for the active ground instead of the root theme's.
       */
      className="pointer-events-none fixed inset-0 z-0 opacity-50"
      style={{
        backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
      }}
    />
  );
}
