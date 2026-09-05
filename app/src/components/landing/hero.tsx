"use client";

/**
 * The fold: indicator, headline, subheadline, two buttons.
 *
 * ## The subheadline is not the one from the brief, and this is why
 *
 * The brief asked for "Out-of-bounds execution is slashed in 300ms." Three separate problems, and the
 * first two are the kind a security audience finds in one question:
 *
 * Slashing and reverting are different mechanisms with different triggers. `PinRegistry`'s `Slashed`
 * event is documented in the contract as firing when a publisher signs conflicting version claims --
 * equivocation -- and `proveEquivocation` is the only path that reaches it. An out-of-bounds call is
 * refused: the transaction reverts and no bond is touched. Saying execution is slashed describes a
 * mechanism this system does not have.
 *
 * The 300ms is invented. viem's own `monadTestnet` definition declares a 400ms block time, so the figure
 * is both unsourced and wrong.
 *
 * And it undersells the real property. Enforcement does not happen in a block after the fact, it happens
 * inside the settling transaction, before value moves. "Reverts before funds move" is a stronger claim
 * than any latency number, and unlike a latency number it is true.
 *
 * The app's own limitations panel says any project claiming code identity without a TEE in the diagram is
 * overclaiming and that one follow-up question exposes it. Shipping the original line would have made this
 * page the example.
 */

import type { Certainty } from "../data";
import { ExploreLink } from "../start";
import { Term } from "../term";

/**
 * @param certainty Whether the badge may claim to be live. Three states, not two.
 *
 * This took a `live: boolean` and printed "NO REGISTRY CONFIGURED" whenever it was false — including for the
 * whole duration of the chain read, because the seeded snapshot is a fixture. So the first thing a visitor
 * saw was the product asserting that its own deployment did not exist, followed by a silent flip to "LIVE ON
 * MONAD TESTNET". "Not yet looked" and "looked and found nothing" need different words.
 */
export function Hero({
  certainty,
  chainId,
}: {
  certainty: Certainty;
  chainId: number | undefined;
}) {
  const live = certainty === "chain";

  return (
    <section className="mx-auto w-full max-w-4xl px-5 pt-14 pb-10 text-center sm:px-8 sm:pt-20 sm:pb-14">
      {/*
        The indicator states which chain and whether the page is actually reading it.

        Not decoration: "Live on Monad Testnet" is a claim, and on a build with no registry configured it
        would be a false one. The label degrades instead of lying, and the dot stops pulsing.
      */}
      <div className="inline-flex items-center gap-2 rounded-pill border border-line bg-raise px-3 py-1.5">
        <span
          className={`relative flex size-1.5 shrink-0 rounded-pill ${
            live
              ? "live-ring bg-bonded text-bonded"
              : certainty === "reading"
                ? "live-ring bg-attention text-attention"
                : "bg-faint text-faint"
          }`}
        />
        <span className="shout text-label text-muted">
          {certainty === "chain"
            ? `Live on Monad ${chainId === 143 ? "mainnet" : "testnet"}`
            : certainty === "reading"
              ? "Reading the registry"
              : "No registry configured"}
        </span>
      </div>

      <h1 className="mt-7 text-4xl leading-[0.95] font-semibold tracking-[-0.04em] text-text sm:mt-8 sm:text-6xl">
        A lockfile for
        <br />
        agent money.
      </h1>

      <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
        Bind every fund-moving call to the exact skill version its owner approved. When the bytes change
        underneath it, the call{" "}
        <span className="font-medium text-text">reverts inside the settling transaction</span> &mdash;
        before value moves, not after.
      </p>

      {/*
        Two buttons, and the second is deliberately the CLI rather than docs.

        Approving a version is a CLI-only operation by design, so the install command is the real second
        step for anyone convinced by the headline. A docs link would be the softer, less useful choice.
      */}
      <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
        {/*
          A button, not a link, and the reason matters.

          The flow gate turns a reader away from product routes until they have been through the first-run
          steps, so `<Link href="/dashboard">` here would bounce them back to this page -- the primary call
          to action doing nothing. `useExplore` records that they chose to look around, which is exactly
          what following this button means, and then navigates.
        */}
        <ExploreLink
          href="/dashboard"
          className="press inline-flex h-11 w-full items-center justify-center rounded-md bg-bonded px-6 text-sm font-medium text-on-face transition-colors sm:w-auto"
        >
          Explore registry
        </ExploreLink>
        <a
          href="#install"
          className="press inline-flex h-11 w-full items-center justify-center rounded-md border border-line-strong px-6 text-sm font-medium text-text transition-colors hover:bg-raise sm:w-auto"
        >
          Install CLI
        </a>
      </div>

      {/*
        Says what the primary button does to the reader's own state.

        Following it writes `skippedSetup`, which `stageFor` treats as permanent, so one click quietly opts
        someone out of the profile and onboarding steps for good. That is the right behaviour -- exploring the
        registry *is* choosing to look around -- but it was happening with nothing on screen to say so.
      */}
      <p className="mt-5 text-label text-faint">
        Exploring skips the setup steps. Nothing is gated, and you can build a profile later from Account.
      </p>

      <p className="mt-6 text-label text-faint">
        EIP-7702 &middot; enforced at <Term name="settlement">settlement</Term> &middot; backed by
        publisher <Term name="bond">bonds</Term>
      </p>
    </section>
  );
}
