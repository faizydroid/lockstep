"use client";

/**
 * A button that sends one of the three allowed writes, with a confirmation that says what it cannot do.
 *
 * The interesting decision here is what the confirmation contains. Most are a restatement of the button
 * plus "are you sure", which trains people to click through -- the exact habit this product exists to
 * counter, so reproducing it in our own UI would be self-defeating.
 *
 * So every confirmation states two things, from `lib/writes.ts`:
 *
 *   The effect. What will be true after.
 *   The limit. What people wrongly assume it does. Withdrawing an approval does not claw back money;
 *   challenging a publisher is not an accusation the chain has to trust. A dialog that only describes the
 *   upside is how those misunderstandings survive.
 *
 * Confirmation strength follows `needsHardConfirm`: actions that grant power ask for a typed
 * confirmation, actions that remove it take one click. Friction on an emergency stop is its own hazard --
 * if withdrawing an approval is tedious, someone leaves a compromised publisher approved.
 */

import { useEffect, useState } from "react";
import type { Hash } from "viem";

import { explorerTxUrl } from "@/lib/chain";
import { needsHardConfirm } from "@/lib/policy";
import { buildWrite } from "@/lib/writes";
import type { WriteName } from "@/lib/writes";

import { Guard } from "./guard";
import { AnimatePresence, SPRING_SOFT, motion, useReducedMotion } from "./motion";
import { useIdentity } from "./identity";
import { Button, HashChip, cx } from "./ui";

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "confirming" }
  | { readonly kind: "signing" }
  | { readonly kind: "sent"; readonly hash: Hash }
  | { readonly kind: "failed"; readonly reason: string };

export function WriteAction({
  name,
  args,
  registry,
  tone = "revoked",
  size = "sm",
  label,
  className,
}: {
  name: WriteName;
  args: readonly unknown[];
  registry: `0x${string}`;
  /** Excludes `neutral`: every one of these actions has consequences and none should look incidental. */
  tone?: "revoked" | "attention" | "bonded" | "pinned" | "equivocated";
  size?: "sm" | "md";
  /** Overrides the default button text. The dialog always uses the copy from lib/writes.ts. */
  label?: string;
  className?: string;
}) {
  const { address, onCorrectChain, walletClient } = useIdentity();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [typed, setTyped] = useState("");

  const request =
    address === undefined ? undefined : buildWrite(name, args, { account: address, registry });

  const hard = needsHardConfirm(name);

  // Escape closes the dialog, which anything modal owes the keyboard.
  useEffect(() => {
    if (phase.kind !== "confirming") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPhase({ kind: "idle" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase.kind]);

  /*
   * Nothing renders without a connected wallet on the right chain.
   *
   * Deliberately absent rather than disabled. A disabled button invites someone to hunt for why it is
   * disabled; the account control in the rail already explains the connection state, and repeating that
   * explanation next to every action would be noise.
   */
  if (request === undefined || !onCorrectChain) return null;

  const send = async () => {
    const client = walletClient();
    if (client === undefined) {
      setPhase({ kind: "failed", reason: "The wallet is no longer connected on Monad testnet." });
      return;
    }

    setPhase({ kind: "signing" });
    try {
      /*
       * `args` is cast because viem infers a tuple per function and this call is generic over three.
       *
       * The cast is safe at exactly one point: `buildWrite` is the only producer of a request, it takes
       * a `WriteName` the type system has already narrowed to the three allowed writes, and it builds
       * the argument list itself rather than forwarding the caller's. So the tuple is correct by
       * construction here even though it cannot be proven at this call site. Widening
       * `WriteRequest.args` to satisfy viem would mean three overloads and a union that has to be
       * re-narrowed anyway; this is the smaller lie and it is contained to one line.
       */
      const hash = await client.writeContract({
        address: request.to,
        abi: request.abi,
        functionName: request.functionName,
        args: request.args as never,
        chain: null,
        account: client.account ?? null,
      });
      setPhase({ kind: "sent", hash });
    } catch (err) {
      // 4001 is the user declining in the wallet, which is not a failure worth a red panel.
      const code = (err as { code?: number }).code;
      if (code === 4001) {
        setPhase({ kind: "idle" });
        return;
      }
      const raw = err instanceof Error ? err.message : String(err);
      setPhase({ kind: "failed", reason: raw.split("\n")[0] ?? "The transaction was rejected." });
    }
  };

  return (
    <>
      {/*
        Spread conditionally rather than passing `className={className}`.
        
        Under `exactOptionalPropertyTypes` an absent optional prop and one explicitly set to `undefined`
        are different types, so forwarding a possibly-undefined value to `className?: string` does not
        typecheck. The same pattern appears in components/motion.tsx for the same reason.
      */}
      <Button
        tone={tone}
        variant="quiet"
        size={size}
        {...(className === undefined ? {} : { className })}
        onClick={() => {
          setTyped("");
          setPhase({ kind: "confirming" });
        }}
      >
        {label ?? request.cta}
      </Button>

      {/*
        The outcome stays in the dialog rather than collapsing to a pill beside the button.

        It used to render a 40px `sent` pill whose only detail -- the transaction hash -- lived in a
        `title` attribute, which is invisible on touch and to a keyboard. So the most consequential moment
        in the product, an irreversible on-chain write, ended in a badge most readers could not read and
        nobody could copy. Same defect the Term work removed, in a worse place.
      */}
      <Confirm
        open={phase.kind !== "idle"}
        phase={phase}
        request={request}
        hard={hard}
        typed={typed}
        onTyped={setTyped}
        onCancel={() => setPhase({ kind: "idle" })}
        onConfirm={() => void send()}
      />
    </>
  );
}

/** The dialog. Guard delivers it, because this is a consequence rather than a form. */
function Confirm({
  open,
  phase,
  request,
  hard,
  typed,
  onTyped,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  phase: Phase;
  request: ReturnType<typeof buildWrite>;
  hard: boolean;
  typed: string;
  onTyped: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const still = useReducedMotion();
  /* The word required for a power-granting action. Short, and not "yes", which is muscle memory. */
  const PHRASE = "authorize";
  const allowed = !hard || typed.trim().toLowerCase() === PHRASE;
  const busy = phase.kind === "signing";
  const settled = phase.kind === "sent" || phase.kind === "failed";

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          <motion.button
            type="button"
            aria-label="Cancel"
            onClick={onCancel}
            className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-sm"
            initial={still ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={still ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.18 }}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={request.title}
            className="pop relative w-full max-w-lg rounded-3xl bg-panel p-6"
            initial={still ? { scale: 1, opacity: 1 } : { scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={still ? { scale: 1, opacity: 0 } : { scale: 0.96, opacity: 0 }}
            transition={still ? { duration: 0 } : SPRING_SOFT}
          >
            <div className="flex items-start gap-4">
              {/*
                The mascot's mood tracks the phase. Alarmed while a decision is pending, watchful once the
                call is in flight -- not pleased. A sent transaction is not a settled one, and a happy
                face here would be the interface asserting an outcome the chain has not returned yet.
              */}
              <Guard
                mood={phase.kind === "sent" ? "watching" : "alarmed"}
                size={68}
                bob={false}
                label={
                  phase.kind === "sent"
                    ? "Guard is watching for the transaction to settle."
                    : "Guard looks alarmed."
                }
              />

              <div className="min-w-0 flex-1 space-y-3">
                <h2 className="font-display text-xl leading-tight font-extrabold text-text">
                  {phase.kind === "sent"
                    ? "Submitted, not yet settled"
                    : phase.kind === "failed"
                      ? "Nothing was sent"
                      : request.title}
                </h2>

                {settled ? null : (
                  <div className="pop rounded-xl bg-raise p-3 [--pop:var(--shade)]">
                    <p className="shout text-[0.6rem] text-faint">What happens</p>
                    <p className="mt-1 text-sm leading-relaxed font-semibold text-text">
                      {request.effect}
                    </p>
                  </div>
                )}

                {phase.kind === "sent" ? <Receipt hash={phase.hash} request={request} /> : null}

                {phase.kind === "failed" ? (
                  <div className="pop rounded-xl bg-revoked-tint p-3 [--line:var(--revoked-ink)] [--pop:var(--revoked-shade)]">
                    <p className="shout text-[0.6rem] text-revoked-ink">Why</p>
                    <p className="mt-1 text-sm leading-relaxed font-semibold text-revoked-ink">
                      Nothing reached the chain, so nothing changed. Your approvals are exactly as they
                      were.
                    </p>
                    {/*
                      The raw string is kept, in a monospace block rather than as prose.
                      
                      It is usually an RPC or revert message written for a developer, and paraphrasing it
                      would lose the one detail that makes it searchable. Presenting it as a quotation
                      rather than as our own sentence is the honest framing.
                    */}
                    <pre className="mt-2 overflow-x-auto text-[0.65rem] leading-relaxed">
                      <code className="hash select-all text-revoked-ink">{phase.reason}</code>
                    </pre>
                  </div>
                ) : null}

                {/*
                  The limit gets its own panel, not a footnote.
                  
                  It is the half a reader is most likely to have wrong, so it is given equal weight
                  rather than tucked under the effect where it reads as small print.
                */}
                <div className="pop rounded-xl bg-attention-tint p-3 [--line:var(--attention)] [--pop:var(--attention-shade)]">
                  <p className="shout text-[0.6rem] text-attention-ink">What it does not do</p>
                  <p className="mt-1 text-sm leading-relaxed font-semibold text-attention-ink">
                    {request.limit}
                  </p>
                </div>

                {hard && !settled ? (
                  <label className="block space-y-1.5">
                    <span className="shout text-[0.6rem] text-faint">
                      This grants power. Type {PHRASE} to continue.
                    </span>
                    <input
                      value={typed}
                      onChange={(e) => onTyped(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      className="chunk hash w-full rounded-lg bg-sunken px-3 py-2 text-sm text-text"
                    />
                  </label>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {settled ? (
                    /*
                      One button, and it says Close rather than Done.
                      
                      "Done" would claim the write succeeded. At this point the only fact available is that
                      a transaction was accepted by an RPC, which is not the same thing and the panel above
                      says so.
                    */
                    <Button tone="neutral" size="sm" onClick={onCancel}>
                      Close
                    </Button>
                  ) : (
                    <>
                      <Button
                        tone={hard ? "attention" : "revoked"}
                        size="sm"
                        onClick={onConfirm}
                        disabled={busy || !allowed}
                      >
                        {busy ? "Check your wallet\u2026" : request.cta}
                      </Button>
                      <Button tone="neutral" variant="quiet" size="sm" onClick={onCancel} disabled={busy}>
                        Cancel
                      </Button>
                    </>
                  )}
                </div>

                {settled ? null : (
                  <p className="text-[0.7rem] leading-snug font-semibold text-faint">
                    Sent from{" "}
                    <code className="hash text-[0.65rem]">{request.functionName}</code> to{" "}
                    <code className="hash text-[0.65rem]">
                      {request.to.slice(0, 10)}&hellip;{request.to.slice(-6)}
                    </code>
                    . Your wallet will show the same call before you sign.
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * What happened, in a form the reader can take away and check.
 *
 * The design material this came from makes two points that pull in opposite directions for a product like
 * this one. The first is the Zeigarnik effect: an action whose completion is not shown nags at people, and
 * they go looking for proof it worked. The second is the advice to celebrate completion -- confetti, a
 * tick, a well done.
 *
 * The first applies here and the second does not. Two reasons. A write on this dashboard revokes an
 * approval or challenges a publisher's bond; confetti on that would be celebrating a loss, and the one
 * genuine milestone this product has -- a refused call -- is a security event rather than an achievement.
 * And more importantly, a submitted transaction is not a settled one. Any celebratory state would be
 * asserting an outcome the chain has not returned, which is precisely the claim-versus-reading confusion
 * the whole product exists to attack.
 *
 * So: no celebration, and no green tick. The receipt states what is actually known, hands over the hash,
 * and points at somewhere the reader can watch it settle for themselves.
 */
function Receipt({ hash, request }: { hash: Hash; request: ReturnType<typeof buildWrite> }) {
  const url = explorerTxUrl(hash);

  return (
    <div className="space-y-3">
      <div className="pop rounded-xl bg-raise p-3 [--pop:var(--shade)]">
        <p className="shout text-[0.6rem] text-faint">Transaction</p>

        {/*
          A full HashChip, not a title attribute. This is the only artefact of an irreversible action and
          the reader needs to be able to read it, copy it, and paste it somewhere else.
        */}
        <div className="mt-1.5">
          <HashChip value={hash} />
        </div>

        <p className="mt-2 text-[0.7rem] leading-relaxed font-semibold text-muted">
          Your wallet accepted <code className="hash text-[0.65rem]">{request.functionName}</code> and
          returned this hash. That means it was submitted, not that it succeeded &mdash; a transaction can
          still revert.
        </p>
      </div>

      <div className="pop rounded-xl bg-attention-tint p-3 [--line:var(--attention)] [--pop:var(--attention-shade)]">
        <p className="shout text-[0.6rem] text-attention-ink">Before you rely on it</p>
        <p className="mt-1 text-sm leading-relaxed font-semibold text-attention-ink">
          This dashboard will show the new state after its next read of the chain, which is not instant.
          Until then the figures behind this dialog are the old ones.
        </p>
      </div>

      {url === undefined ? null : (
        /*
          A plain link, opened in a new tab, and it says where it goes.
          
          An explorer is a third party. Naming it rather than styling it as a product button keeps the
          trust boundary visible, which matters more here than on a page that only reads.
        */
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="shout press pop-sm inline-flex items-center gap-1.5 rounded-lg bg-panel px-3 py-1.5 text-[0.6rem] text-muted [--pop:var(--shade)] hover:text-text"
        >
          Watch it settle on the explorer
          <span aria-hidden="true">&rarr;</span>
        </a>
      )}
    </div>
  );
}

/** Kept exported so a page can show the phrase in its own copy without duplicating it. */
export const HARD_CONFIRM_PHRASE = "authorize";

/** Re-exported so callers do not import from two places to render one button. */
export { cx };
