"use client";

/**
 * Approvals: what this account currently trusts, what it has executed, and how to stop it.
 *
 * There is deliberately no approve button, and there is a withdraw one. That asymmetry is the whole
 * design: approving vouches for bytes and only the machine holding them can do that honestly, so it
 * lives in the CLI; withdrawing only ever narrows what an agent may do, so putting it one click from
 * whatever device is to hand is a feature rather than a risk. See lib/policy.ts for the rule.
 */

import Link from "next/link";

import { useSnapshot } from "@/components/data";
import { Reveal, RevealGroup, RevealItem } from "@/components/motion";
import { Card, Empty, HashChip, Pill, Section, StatePill, Table, Td, Th } from "@/components/ui";
import { WriteAction } from "@/components/write-action";
import { readConfig } from "@/lib/chain";
import { formatNative, timeAgo } from "@/lib/format";

export default function ApprovalsPage() {
  const { snapshot } = useSnapshot();
  const { approvals, pins, executions } = snapshot;

  /*
   * The registry address, for the write actions.
   *
   * Taken from config rather than from `snapshot.source`, because the source is `sample` until the chain
   * read lands and the buttons should not change identity underneath a reader mid-load. A zero address
   * here simply means the actions render nothing, which is the correct behaviour with nothing deployed.
   */
  const registryAddress =
    readConfig().registry ?? ("0x0000000000000000000000000000000000000000" as const);

  const pinFor = (pinId: string) => pins.find((p) => p.pinId === pinId);

  return (
    <div className="space-y-14">
      <Reveal>
        <Section
          eyebrow="Account policy"
          title="Approved versions"
          description={
            <>
              Under EIP-7702 the guard runs at the account&rsquo;s own address, so this list lives
              in the account&rsquo;s storage rather than in a shared registry. Each entry names one
              exact set of bytes. Nothing else can move funds.
            </>
          }
          aside={
            <Pill tone="neutral" title="This interface cannot sign. Approval happens through the CLI.">
              read only
            </Pill>
          }
        >
          {approvals.length === 0 ? (
            <Empty title="No approvals on this account">
              Either nothing has been approved, or no account address is configured. Set
              NEXT_PUBLIC_ACCOUNT_ADDRESS to read a delegated account&rsquo;s policy.
            </Empty>
          ) : (
            <RevealGroup className="space-y-3">
              {approvals.map((approval) => {
                const pin = pinFor(approval.pinId);
                return (
                  <RevealItem key={approval.pinId}>
                    <Card className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="space-y-2">
                          <p className="font-display text-lg leading-tight text-text">
                            {pin?.skillName ?? "unknown skill"}
                            {pin?.skillVersion === undefined ? null : (
                              <span className="ml-2 text-sm text-faint">{pin.skillVersion}</span>
                            )}
                          </p>

                          <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
                            <span>pin</span>
                            <HashChip value={approval.pinId} emphasis="quiet" />
                            {pin === undefined ? null : (
                              <>
                                <span>hash</span>
                                <HashChip value={pin.skillHash} emphasis="quiet" />
                              </>
                            )}
                          </div>

                          {pin === undefined ? null : (
                            <p className="text-xs text-muted">
                              {pin.capabilities.length}{" "}
                              {pin.capabilities.length === 1 ? "capability" : "capabilities"}
                              {pin.capabilities.some((c) => c.highRisk)
                                ? ` \u00b7 ${pin.capabilities.filter((c) => c.highRisk).length} high risk`
                                : ""}{" "}
                              &middot; ceiling {formatNative(pin.maxValuePerCall)}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          {pin === undefined ? (
                            <Pill tone="attention" title="Approved, but the registry has no live pin for it.">
                              pin not found
                            </Pill>
                          ) : (
                            <StatePill state={pin.state} />
                          )}
                          <span className="text-xs font-semibold text-faint">
                            {timeAgo(approval.approvedAt)}
                          </span>

                          {/*
                            The emergency stop, next to the thing it stops.
                            
                            Renders nothing unless the viewer's wallet is connected on Monad testnet, and
                            the guard's `onlySelf` means it only works when that wallet IS this account.
                            Withdrawing narrows what the agent may do, so it takes one click; re-approving
                            needs the CLI, because approving means vouching for bytes.
                          */}
                          <WriteAction
                            name="unapprovePin"
                            args={[approval.pinId]}
                            registry={registryAddress}
                            tone="revoked"
                            label="Withdraw"
                          />
                        </div>
                      </div>

                      {pin !== undefined && pin.state === "revoked" ? (
                        <p className="mt-4 rounded-lg bg-revoked-tint px-3 py-2 text-xs leading-relaxed text-revoked-ink">
                          The publisher has revoked this release since it was approved. A revoked
                          pin reports no hash, so calls against it are refused even though the
                          approval is still recorded here.
                        </p>
                      ) : null}
                    </Card>
                  </RevealItem>
                );
              })}
            </RevealGroup>
          )}
        </Section>
      </Reveal>

      <Section
        eyebrow="Settled"
        title="Executed under an approved pin"
        description="Each row is a SkillExecuted event from the account. The pin and hash recorded here are what the guard checked before letting the calls through."
      >
        {executions.length === 0 ? (
          <Empty title="Nothing executed yet">
            The account has not run a guarded batch. Successful executions emit an event and are
            listed here; refusals do not, which is why blocked attempts come from reverted
            transaction traces instead.
          </Empty>
        ) : (
          <Reveal>
            <Table>
              <thead>
                <tr>
                  <Th>Skill</Th>
                  <Th>Hash checked</Th>
                  <Th>Executor</Th>
                  <Th className="text-right">Calls</Th>
                  <Th className="text-right">When</Th>
                </tr>
              </thead>
              <tbody>
                {executions.map((execution) => {
                  const pin = pinFor(execution.pinId);
                  return (
                    <tr key={execution.txHash} className="transition-colors hover:bg-raise">
                      <Td>
                        {pin === undefined ? (
                          <HashChip value={execution.pinId} emphasis="quiet" />
                        ) : (
                          <Link
                            href={{ pathname: "/pins", query: { pin: execution.pinId } }}
                            className="text-text underline decoration-line-strong underline-offset-4 hover:decoration-text"
                          >
                            {pin.skillName ?? "unnamed"}
                          </Link>
                        )}
                      </Td>
                      <Td>
                        <HashChip value={execution.skillHash} emphasis="quiet" />
                      </Td>
                      <Td>
                        <HashChip value={execution.executor} kind="address" emphasis="quiet" />
                      </Td>
                      <Td className="text-right text-muted">{execution.callCount}</Td>
                      <Td className="text-right text-faint">{timeAgo(execution.timestamp)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Reveal>
        )}
      </Section>

      <Reveal>
        <Card className="bg-raise">
          <h3 className="font-display text-lg text-text">The executor is not the account</h3>
          <p className="mt-3 measure text-sm leading-relaxed text-muted">
            An agent holds an executor key, which pays gas and can ask the guard to run a batch. It
            never holds the account key. That separation is what makes the guard enforceable rather
            than advisory: an agent holding the account key could sign straight past it, so the
            chain adapter refuses to start if the two are ever the same.
          </p>
        </Card>
      </Reveal>
    </div>
  );
}
