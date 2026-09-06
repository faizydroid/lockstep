"use client";

/**
 * Says where the numbers came from, on every page.
 *
 * Not a nicety. A dashboard for a security product that shows invented figures without saying so is
 * worse than one that shows nothing, because a reader will quote them. So the source is always on
 * screen, above the content, and sample data is named as sample data.
 */

import { AnimatePresence, motion } from "framer-motion";

import { useAccountSource, useSnapshot } from "./data";
import { useSettings } from "./settings";
import { HashChip, Pill } from "./ui";
import { shortAddress } from "@/lib/format";
import { rpcHost } from "@/lib/settings";

export function SourceBanner() {
  const { status, snapshot } = useSnapshot();
  const { source } = snapshot;
  const { settings } = useSettings();

  /*
   * Short labels naming everything in effect that changes what this page reads.
   *
   * A list now, not one label. This was a chained ternary that returned the first match, so a reader with a
   * custom RPC *and* a custom account was told about the RPC only -- and the whole condition attached to
   * allowing those overrides is that they get disclosed. One winning over another was a quiet way to
   * half-honour it.
   *
   * Deliberately terse and deliberately present. The full explanation lives in Account; what this bar owes a
   * reader is that the numbers beside it are not the default build's.
   */
  const host = rpcHost(settings);
  const account = useAccountSource();

  const notes: { readonly label: string; readonly title: string }[] = [];

  if (host !== undefined) {
    notes.push({
      label: `custom RPC \u00b7 ${host}`,
      title: "A setting is changing which endpoint this page reads. Clear it in Account, settings.",
    });
  }

  /*
   * Which account these figures are about, whenever it is not the reader's own wallet.
   *
   * The `build` case is why this exists, and it is the one nothing disclosed before. Disconnecting clears the
   * wallet and the account override together, so the resolution falls through to the address the build ships
   * -- and every account-scoped figure on the page becomes somebody else's while still looking like it is
   * about the reader. Naming it "the deployment's example account" is the difference between a page that
   * changed subject and a page that said so.
   *
   * `wallet` gets no note. It is the expected case, the address is already in the chrome two inches away, and
   * a pill restating it would be the third place on screen saying the same thing.
   */
  if (account.origin === "setting") {
    notes.push({
      label: `custom account \u00b7 ${shortAddress(account.address ?? "")}`,
      title: "A setting is pointing this page at an address other than your wallet. Clear it in Account, settings.",
    });
  } else if (account.origin === "build") {
    notes.push({
      label: `demo account \u00b7 ${shortAddress(account.address ?? "")}`,
      title:
        "No wallet is connected, so approvals, drift and executions on this page belong to the account this deployment ships as its example. Connect a wallet to see your own.",
    });
  } else if (account.origin === "none") {
    notes.push({
      label: "no account",
      title:
        "Nothing names an account, so the pages about one — approvals, drift, enforcement — have nothing to read. Connect a wallet or set one in Account, settings.",
    });
  }

  if (settings.deployBlock !== undefined) {
    notes.push({
      label: "custom start block",
      title: "A setting is changing where log scanning begins, which costs completeness. Clear it in Account, settings.",
    });
  }

  return (
    <div className="gutter relative z-10 w-full pt-3">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={status === "loading" ? "loading" : source.kind}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className={
            /*
             * Deliberately asymmetric: quiet when live, loud when not.
             *
             * A reviewer looked at this dashboard and read the sample figures as claims about a real
             * deployment. The disclosure existed -- an amber pill, in a thin pill-shaped bar -- and it
             * lost to the numbers, which are set at 10rem. Being technically honest in a small font is
             * not the same as being understood, and for a security product the failure mode is that
             * someone quotes an invented number in public.
             *
             * So the sample state now gets the full 2px border and hard underside every other panel
             * has, in attention amber, at the top of every page. The live state stays a slim pill,
             * because a confirmation nobody needs to read should not compete with the content.
             */
            /*
             * The live bar is deliberately the smallest thing on the page. It was `py-2 px-4` in a
             * band with `pt-4` above it, which is around 58px spent on a confirmation nobody needs
             * to read, on every page, above the fold. The sample bar keeps its full padding: that
             * one does need reading.
             */
            status !== "loading" && source.kind === "chain"
              ? "chunk inline-flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-pill bg-raise px-3 py-1 text-xs"
              : "pop flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-attention-tint px-5 py-3.5 text-xs [--line:var(--attention)] [--pop:var(--attention-shade)]"
          }
        >
          {status === "loading" ? (
            <>
              <Pill tone="neutral">
                <motion.span
                  aria-hidden
                  className="size-1.5 rounded-pill bg-muted"
                  animate={{ opacity: [1, 0.25, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                />
                reading chain
              </Pill>
              <span className="font-semibold text-attention-ink">
                Showing sample figures until the read completes.
              </span>
            </>
          ) : source.kind === "chain" ? (
            <>
              <Pill tone="bonded">live</Pill>
              <span className="font-semibold text-muted">
                chain {source.chainId} &middot; block {source.blockNumber.toString()}
              </span>
              {/*
                The registry address is the least urgent thing here and the widest. It is the first
                casualty on a narrow screen, where it was pushing the bar onto a second line.
              */}
              <span className="hidden text-faint sm:inline">registry</span>
              <span className="hidden sm:inline">
                <HashChip value={source.registry} kind="address" emphasis="quiet" />
              </span>

              {/*
                Settings that change what is read have to say so here.

                This is the condition attached to allowing an RPC or account override at all. Without
                it, a reader could point the dashboard at their own endpoint and every page would look
                exactly as canonical as the default build -- which is the one thing this app's own
                argument does not permit. The host is shown and never the path, since a self-hosted
                endpoint routinely carries a key in it.
              */}
              {notes.map((note) => (
                <span key={note.label} className="inline-flex items-center gap-2">
                  <span aria-hidden className="text-faint">
                    &middot;
                  </span>
                  <Pill tone="attention" title={note.title}>
                    {note.label}
                  </Pill>
                </span>
              ))}
            </>
          ) : (
            <>
              <Pill tone={source.kind === "error" ? "revoked" : "attention"}>
                {source.kind === "error" ? "chain read failed" : "sample data"}
              </Pill>
              {/*
                States the consequence, not just the condition. "sample data" tells a reader what mode
                the app is in; "not readings from a deployment" tells them what the numbers are worth,
                which is the part that stops one being quoted.
              */}
              <span className="font-extrabold text-attention-ink">
                Every figure on this page is a worked example, not a reading from a deployment.
              </span>
              <span className="font-semibold text-attention-ink opacity-80">{source.reason}</span>
              <span className="hidden font-semibold text-attention-ink opacity-70 sm:inline">
                Set NEXT_PUBLIC_PIN_REGISTRY to read one.
              </span>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
