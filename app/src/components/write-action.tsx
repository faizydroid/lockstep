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

import { needsHardConfirm } from "@/lib/policy";
import { buildWrite } from "@/lib/writes";
import type { WriteName } from "@/lib/writes";

import { Guard } from "./guard";
import { AnimatePresence, SPRING_SOFT, motion, useReducedMotion } from "./motion";
import { useIdentity } from "./identity";
import { Button, Pill, cx } from "./ui";

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

      {phase.kind === "sent" ? (
        <Pill tone="bonded" className="ml-2" title={phase.hash}>
          sent
        </Pill>
      ) : null}
      {phase.kind === "failed" ? (
        <span className="ml-2 text-xs font-bold text-revoked-ink">{phase.reason}</span>
      ) : null}

      <Confirm
        open={phase.kind === "confirming" || phase.kind === "signing"}
        busy={phase.kind === "signing"}
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
  busy,
  request,
  hard,
  typed,
  onTyped,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
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
              <Guard mood="alarmed" size={68} bob={false} label="Guard looks alarmed." />

              <div className="min-w-0 flex-1 space-y-3">
                <h2 className="font-display text-xl leading-tight font-extrabold text-text">
                  {request.title}
                </h2>

                <div className="pop rounded-xl bg-raise p-3 [--pop:var(--shade)]">
                  <p className="shout text-[0.6rem] text-faint">What happens</p>
                  <p className="mt-1 text-sm leading-relaxed font-semibold text-text">
                    {request.effect}
                  </p>
                </div>

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

                {hard ? (
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
                </div>

                <p className="text-[0.7rem] leading-snug font-semibold text-faint">
                  Sent from{" "}
                  <code className="hash text-[0.65rem]">{request.functionName}</code> to{" "}
                  <code className="hash text-[0.65rem]">
                    {request.to.slice(0, 10)}&hellip;{request.to.slice(-6)}
                  </code>
                  . Your wallet will show the same call before you sign.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

/** Kept exported so a page can show the phrase in its own copy without duplicating it. */
export const HARD_CONFIRM_PHRASE = "authorize";

/** Re-exported so callers do not import from two places to render one button. */
export { cx };
