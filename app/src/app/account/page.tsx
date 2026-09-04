"use client";

/**
 * Account: who you are here, whether anything is enforcing it, and the few things you can change.
 *
 * ## Why profile and settings share a route
 *
 * The rail had seven items. Two more would make it nine, at which point a primary navigation stops
 * being a menu and becomes a list to scan. Both surfaces answer the same question -- things about me,
 * as opposed to things about the registry -- so they are two sections of one route, deep-linkable at
 * `/account#settings`.
 *
 * ## Why the profile leads with delegation rather than with an address
 *
 * The wallet already shows the address. The fact a viewer cannot get anywhere else is whether their
 * approvals are currently being enforced, and that is a property of the account's *code*.
 *
 * `contracts/test/GatorComparison.t.sol` is where this stopped being theoretical. EIP-7702 delegation
 * changes an account's code and not its storage, so re-delegating an account elsewhere -- which
 * `gator create` and every other 7702 upgrade flow does -- leaves every approval sitting in the
 * ERC-7201 slot with nothing reading them. Storage looks identical. An interface that listed approvals
 * without checking the code would report that account as protected, confidently, at the exact moment
 * it was not.
 *
 * So the delegation card is first, it is the largest thing on the page, and it turns red when the
 * answer is no.
 */

import { useState } from "react";
import type { Address } from "viem";

import { useSnapshot } from "@/components/data";
import { useIdentity } from "@/components/identity";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion";
import { SettingsPanel } from "@/components/settings-panel";
import { useSettings } from "@/components/settings";
import { Term } from "@/components/term";
import { Verify } from "@/components/verify";
import { readConfig } from "@/lib/chain";
import { Button, Card, Empty, HashChip, Pill, Section, Stat, cx } from "@/components/ui";
import { formatBondWith } from "@/lib/bond";
import { delegationCopy } from "@/lib/profile";

type Tab = "profile" | "settings";

export default function AccountPage() {
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <div className="space-y-10">
      <Reveal>
        <Section
          eyebrow="You"
          title="Account"
          description={
            <>
              Whose approvals this dashboard is showing, whether anything is enforcing them, and the
              handful of things you can change about how it reads the chain. Connecting a wallet here
              is identity, not authority &mdash; approving a skill version stays in the CLI.
            </>
          }
          aside={
            <div className="chunk inline-flex rounded-pill bg-raise p-1">
              {(["profile", "settings"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTab(option)}
                  aria-pressed={tab === option}
                  className={cx(
                    "shout press rounded-pill px-4 py-1.5 text-[0.65rem]",
                    tab === option
                      ? "pop-sm bg-panel text-text [--line:var(--line)]"
                      : "text-muted hover:text-text",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          }
        />
      </Reveal>

      {tab === "profile" ? <Profile /> : <div id="settings"><SettingsPanel /></div>}
    </div>
  );
}

function Profile() {
  const { snapshot } = useSnapshot();
  const { account, approvals, executions, publishers, pricing } = snapshot;
  const { connected, address, available, connect, connecting, onCorrectChain, switchChain } =
    useIdentity();
  const { settings } = useSettings();

  if (account === undefined) {
    return (
      <Reveal>
        <Empty title="No account to show">
          {available
            ? "Connect a wallet, or set an address in settings, and this page will read that account's delegation, approvals and bond position straight off the chain."
            : "No wallet was found in this browser. Set an address in settings and this page will still read it \u2014 everything here is a public read, so it needs no key."}
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {available ? (
              <Button onClick={() => void connect()} disabled={connecting} tone="pinned" size="sm">
                {connecting ? "Connecting\u2026" : "Connect a wallet"}
              </Button>
            ) : null}
          </div>
        </Empty>
      </Reveal>
    );
  }

  const enforced = account.guard.kind === "confirmed" && account.pointedAtConfiguredGuard;

  // The endpoint the page actually read, so a settings override is reflected in the printed command.
  const rpcUrl = settings.rpcUrl ?? readConfig().rpcUrl;
  const publisher = publishers.find(
    (p) => p.address.toLowerCase() === account.address.toLowerCase(),
  );

  return (
    <div className="space-y-8">
      {/* The one fact that is not available anywhere else, at the size it deserves. */}
      <Reveal>
        <Card tone={enforced ? "bonded" : "revoked"} spotlight className="p-8 sm:p-10">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <Pill tone={enforced ? "bonded" : "revoked"}>
                {enforced ? "enforcement live" : "not enforced"}
              </Pill>
              <HashChip value={account.address} kind="address" />
              {connected && address?.toLowerCase() === account.address.toLowerCase() ? (
                <Pill tone="pinned">your connected wallet</Pill>
              ) : (
                <Pill tone="neutral">read-only</Pill>
              )}
            </div>

            <p className="font-display text-2xl leading-tight font-extrabold text-text sm:text-3xl">
              {enforced
                ? "Every fund-moving call from this account is checked before it settles."
                : "Nothing is checking calls from this account."}
            </p>

            <p className="measure text-sm leading-relaxed font-semibold text-muted">
              {delegationCopy(account.delegation, account.guard)}
            </p>

            <dl className="grid gap-3 border-t-2 border-line pt-5 text-xs font-semibold sm:grid-cols-2">
              <Fact label="Account code">
                {account.delegation.kind === "delegated" ? (
                  <span className="hash text-text">0xef0100 &middot; delegated</span>
                ) : account.delegation.kind === "contract" ? (
                  <span className="text-revoked-ink">{account.delegation.size} bytes, a contract</span>
                ) : (
                  <span className="text-revoked-ink">empty, a plain EOA</span>
                )}
              </Fact>

              <Fact label="Delegated to">
                {account.delegation.kind === "delegated" ? (
                  <HashChip value={account.delegation.implementation} kind="address" emphasis="quiet" />
                ) : (
                  <span className="text-faint">&mdash;</span>
                )}
              </Fact>

              <Fact label="guardStorageSlot() answered">
                {account.guard.kind === "confirmed" ? (
                  <span className="text-bonded-ink">yes, and it is LockstepGuard&rsquo;s slot</span>
                ) : account.guard.kind === "other" ? (
                  <span className="text-revoked-ink">yes, but a different slot</span>
                ) : (
                  <span className="text-faint">no answer</span>
                )}
              </Fact>

              <Fact label="Points at this build&rsquo;s guard">
                {account.pointedAtConfiguredGuard ? (
                  <span className="text-bonded-ink">yes</span>
                ) : (
                  <span className="text-attention-ink">no, or no guard configured</span>
                )}
              </Fact>
            </dl>

            {/*
              Both checks are shown because they can disagree, and the disagreement is the finding.
              The contract asks for exactly this pairing in guardStorageSlot()'s own doc comment.
            */}
            <p className="text-xs leading-relaxed font-semibold text-faint">
              Two checks, not one. The slot call proves the code is the{" "}
              <Term name="guard">guard</Term>; the code comparison proves this account&rsquo;s{" "}
              <Term name="delegation">delegation</Term> is pointed at it. Either alone can be satisfied
              while the other is not, which is why <code className="hash">guardStorageSlot()</code> asks
              for both in its own documentation.
            </p>

            {/*
              `cast code` rather than the slot call, because it is the check a reader can do without
              knowing what the expected slot is. The delegation indicator is self-describing: 23 bytes
              beginning ef0100, and the twenty after the prefix are the implementation. A reader can
              compare that tail against the guard address on the same screen.
            */}
            <Verify
              command={`cast code ${account.address} --rpc-url ${rpcUrl}`}
              expect={
                account.delegation.kind === "delegated"
                  ? `0xef0100${account.delegation.implementation.slice(2)} \u2014 the 7702 indicator, then the implementation it points at.`
                  : account.delegation.kind === "contract"
                    ? "a long bytecode string \u2014 this is a contract, not a delegated EOA."
                    : "0x \u2014 empty. Nothing is delegated, so nothing is enforcing."
              }
              note="23 bytes is the whole indicator, and there is room in it for exactly one address. That is why an account cannot carry two delegations, and why moving one silently stops enforcement."
            />
          </div>
        </Card>
      </Reveal>

      {connected && !onCorrectChain ? (
        <Reveal>
          <Card tone="attention">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="measure text-sm leading-relaxed font-semibold text-muted">
                Your wallet is connected on a different chain. Reads here are unaffected, but the
                narrowing writes are disabled until it is on Monad testnet.
              </p>
              <Button onClick={() => void switchChain()} tone="attention" size="sm">
                Switch chain
              </Button>
            </div>
          </Card>
        </Reveal>
      ) : null}

      <RevealGroup className="grid gap-4 sm:grid-cols-3 2xl:gap-6">
        <RevealItem>
          <Stat
            label="Pins approved"
            value={approvals.length}
            hint="Approved from the CLI, recorded in this account's own storage. Enforced only while the delegation above holds."
            tone={approvals.length > 0 ? "pinned" : "neutral"}
          />
        </RevealItem>
        <RevealItem>
          <Stat
            label="Guarded executions"
            value={executions.length}
            hint="Calls that passed the guard and settled. Refusals leave no log by design, so they are not counted here."
          />
        </RevealItem>
        <RevealItem>
          <Stat
            label="Bond locked"
            value={publisher === undefined ? "\u2014" : formatBondWith(pricing, publisher.lockedBond)}
            hint={
              publisher === undefined
                ? "This account has not published to the registry, so it has no collateral at stake."
                : "Collateral this account has locked against its own releases."
            }
            {...(publisher !== undefined && publisher.lockedBond > 0n
              ? ({ tone: "bonded" } as const)
              : {})}
          />
        </RevealItem>
      </RevealGroup>

      {publisher === undefined ? null : (
        <Reveal>
          <Card className="bg-raise">
            <h3 className="font-display text-lg text-text">This account is also a publisher</h3>
            <p className="mt-3 measure text-sm leading-relaxed text-muted">
              It has {publisher.pinCount} pin{publisher.pinCount === 1 ? "" : "s"} in this registry
              and {publisher.hasEquivocated ? "has been slashed for equivocation" : "a clean record"}.
              Worth knowing when reading the reviewer panel on{" "}
              <a className="underline decoration-2 underline-offset-2" href="/publishers">
                publishers
              </a>
              : an account that approves its own release is vouching for itself, which is true and is
              not independent review.
            </p>
          </Card>
        </Reveal>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <dt className="text-faint">{label}</dt>
      <dd className="flex items-center gap-2">{children}</dd>
    </div>
  );
}
