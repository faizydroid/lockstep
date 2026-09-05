"use client";

/**
 * The landing page.
 *
 * ## The sequence is the argument
 *
 *   header       three links, no rail
 *   hero         one claim, two buttons
 *   the hook     two fingerprints that disagree, and the refusal
 *   the proof    live registry figures, read rather than written
 *   mechanism    three steps, with the identifiers involved
 *   boundary     collapsed, at the bottom, one click from the header
 *
 * Everything above the boundary works without a wallet. That ordering is the reciprocity argument from the
 * onboarding research -- a product that asks before it gives reads like a restaurant wanting a card before
 * showing a menu -- and it is also just honest about what this page can prove. The registry table is a
 * reading anyone can check; the hero is a claim they cannot.
 *
 * ## What changed from the brief, and why
 *
 * Four factual corrections, each documented at the component that carries the copy:
 *
 *   `hero.tsx`      "slashed in 300ms" conflates two mechanisms and invents a latency figure
 *   `hook.tsx`      "62 bytes changed" mislabels hash positions as bytes
 *   `hook.tsx`      a revert does not slash a bond; equivocation does, separately
 *   `registry.tsx`  every supplied metric is derived from the snapshot instead of hardcoded
 *
 * The first two would have been caught by any reader who counted the cells or read the contract. The third
 * is the one that mattered: this project's own limitations panel says that claiming more than the mechanism
 * delivers is what one follow-up question exposes, and shipping it would have made this page the example.
 *
 * ## Why this surface does not follow the theme toggle
 *
 * `.clinical` pins it to a near-black ground in both themes. The rest of the app follows the reader's
 * choice and should; a marketing page benefits more from one consistent first impression, and the reader
 * has expressed no preference yet when they arrive.
 */

import { useCertainty, useSnapshot } from "@/components/data";
import { Hero } from "@/components/landing/hero";
import { Hook } from "@/components/landing/hook";
import { Mechanism } from "@/components/landing/mechanism";
import { Registry } from "@/components/landing/registry";
import { LandingFooter, LandingHeader } from "@/components/landing/shell";
import { ThreatModel } from "@/components/landing/threat-model";
import { StartHere } from "@/components/start";

export default function LandingPage() {
  const { snapshot } = useSnapshot();

  /*
   * Three states, not two.
   *
   * `source.kind === "chain"` is false while the read is in flight, because the provider seeds a fixture
   * snapshot so the first paint is a complete layout rather than a page of skeletons. Deriving "live" from it
   * therefore made this page assert that no registry was configured for the first second of every visit. See
   * `useCertainty` in components/data.tsx.
   */
  const certainty = useCertainty();
  const live = certainty === "chain";

  /*
   * The hook needs two hashes that genuinely disagree, and handles not having them.
   *
   * `drifted[0]` is the real case. When there is none -- a registry where nothing has diverged, which is
   * the healthy state -- `Hook` renders a panel saying exactly that rather than synthesising a second hash
   * to keep the graphic populated. See the note in `hook.tsx`: an earlier version passed the same hash in
   * twice and produced a revert toast over two identical fingerprints.
   */
  const drift = snapshot.drifted[0];

  return (
    <div className="min-h-dvh">
      <LandingHeader />

      {/*
        `id="main"` so the layout's skip link works here.

        It was broken on this route: the skip link targets `#main`, which lived inside the app chrome, and
        this page opts out of that chrome. A keyboard user landing on the front page had a skip link that
        went nowhere -- which is worse than not having one, because it looks like the page is broken.
      */}
      <main id="main">
        <Hero
          certainty={certainty}
          chainId={snapshot.source.kind === "chain" ? snapshot.source.chainId : undefined}
        />

        <Hook approvedHash={drift?.approvedHash} currentHash={drift?.currentHash} live={live} />

        <Registry snapshot={snapshot} certainty={certainty} />

        <Mechanism />

        {/*
          The ask, once, after the argument and before the boundary.

          `StartHere` carries the wallet priming and the durable skip, so a reader who will not connect is
          not stranded here -- which matters more on this page than anywhere else, since the people this is
          built for are the most likely to refuse.
        */}
        <section className="mx-auto w-full max-w-3xl px-5 pb-16 sm:px-8 sm:pb-20">
          <StartHere />
        </section>

        <ThreatModel />
      </main>

      <LandingFooter />
    </div>
  );
}
