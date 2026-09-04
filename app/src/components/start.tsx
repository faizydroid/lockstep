"use client";

/**
 * The two ways out of the landing page.
 *
 * ## Why there is a skip, prominently
 *
 * The requested flow is landing, connect, profile, onboarding, dashboard. Implemented as a wall, that
 * flow would be wrong for this product specifically: the first screen's whole job is to make an argument
 * to a sceptic, and a sceptic who cannot examine the argument without producing a wallet leaves. The
 * people this is built for are the most likely to refuse, not the least.
 *
 * It would also be a claim the architecture cannot back. This is a static export -- every route is a file
 * that can be requested directly -- so a gate here is an ordering, not an authorisation. Presenting it as
 * a login would be asserting a property that does not exist, which is the one kind of dishonesty this
 * product cannot afford.
 *
 * So connecting is the primary path and looking around is a real, durable second one. `stageFor` treats
 * the skip as permanent rather than per-visit, and a reader who skips can still build a profile later from
 * the account page.
 *
 * ## Why the wallet copy comes before the button
 *
 * Same reason as `account-control.tsx`: the moment a wallet popup appears is the moment someone decides
 * whether this is a phishing page, and by then any reassurance is too late to read. No signature is
 * requested, the address is not sent anywhere, and there is nowhere to send it to.
 */

import { useRouter } from "next/navigation";

import { useIdentity } from "./identity";
import { useSettings } from "./settings";
import { Button, Card, Pill, cx } from "./ui";

export function StartHere({ compact = false }: { compact?: boolean }) {
  const { connected, available, connect, connecting } = useIdentity();
  const { settings, update } = useSettings();
  const router = useRouter();

  /*
   * Connecting is enough on its own.
   *
   * The gate watches `connected` and moves the reader to the profile step, so this does not navigate
   * after a successful connect -- doing both would race the gate and could land someone on the profile
   * page twice in one history entry. The exception is a reader who is already connected and reading the
   * landing page again, where nothing will change and so nothing would move them.
   */
  const start = async () => {
    if (connected) {
      router.push("/start/profile");
      return;
    }
    await connect();
  };

  const lookAround = () => {
    update({ skippedSetup: true });
    router.push("/dashboard");
  };

  /*
   * Both paths render unconditionally, and that is a fix rather than a detail.
   *
   * The first version hid "Look around first" unless a wallet was present, which got two things wrong. A
   * reader with no extension was left with a single button, so the escape hatch existed only for the
   * people who least needed it. And because `available` is false until the client checks for a provider,
   * the escape hatch was absent from the static HTML entirely -- caught by `check-export`, which is
   * exactly the class of thing that check is for.
   */
  const buttons = (
    <div className="flex flex-wrap items-center gap-3">
      {available ? (
        <Button tone="bonded" size={compact ? "sm" : "md"} onClick={() => void start()} disabled={connecting}>
          {connecting ? "Check your wallet\u2026" : connected ? "Continue" : "Connect a wallet"}
        </Button>
      ) : null}

      <Button
        tone={available ? "neutral" : "bonded"}
        variant={available ? "quiet" : "solid"}
        size={compact ? "sm" : "md"}
        onClick={lookAround}
      >
        Look around first
      </Button>
    </div>
  );

  if (compact) return buttons;

  return (
    <Card tone="pinned">
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="shout text-[0.6rem] text-faint">Where to next</p>
          <h2 className="font-display text-2xl leading-tight font-extrabold text-text">
            {settings.skippedSetup
              ? "You already have the run of the place"
              : "Point it at your own account"}
          </h2>
          <p className="measure text-sm leading-relaxed font-semibold text-muted">
            {settings.skippedSetup
              ? "Nothing here is gated. Connecting a wallet only changes whose approvals the dashboard reads, and you can do it any time from the account page."
              : "Connecting tells the dashboard whose approvals and whose enforcement to read. Everything above works without it \u2014 the numbers just belong to somebody else."}
          </p>
        </div>

        {buttons}

        {/*
          Said whether or not a wallet is present.

          It describes what connecting here does, which is worth knowing before deciding to install
          anything, and it is the priming that has to arrive before the popup rather than after. Gating it
          on `available` also kept it out of the static HTML, where a reader with scripts blocked would
          never have seen it at all.
        */}
        <p className="text-[0.7rem] leading-relaxed font-semibold text-faint">
          No signature is requested and nothing is sent anywhere. The address stays in this browser,
          because this is a static site with no server behind it.
          {available ? null : " No wallet is detected here, so nothing will prompt you."}
        </p>
      </div>
    </Card>
  );
}

/**
 * The header on a flow stage.
 *
 * Counts only the steps the reader has to do something in, so the landing page is not step one. Being
 * told "step 2 of 3" while reading a pitch you did not ask to be counted for is how a two-field form
 * starts to feel like an application.
 */
export function StageHeader({
  step,
  title,
  children,
}: {
  step: 1 | 2;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="pinned">Step {step} of 2</Pill>
        {/*
          The dots are decoration, and the pill beside them already says the same thing in words. Marked
          hidden so a screen reader is not read a row of bullets after being told the position.
        */}
        <span aria-hidden className="flex items-center gap-1.5">
          {[1, 2].map((n) => (
            <span
              key={n}
              className={cx(
                "block h-1.5 rounded-pill transition-all",
                n === step ? "w-6 bg-pinned" : "w-1.5 bg-line-strong",
              )}
            />
          ))}
        </span>
      </div>

      <h1 className="font-display text-3xl leading-tight font-extrabold text-text sm:text-4xl">
        {title}
      </h1>

      {children === undefined ? null : (
        <p className="measure text-sm leading-relaxed font-semibold text-muted">{children}</p>
      )}
    </header>
  );
}
