"use client";

/**
 * Step one of two: a local label for whoever is reading.
 *
 * ## What this is, stated plainly because the shape invites the wrong assumption
 *
 * It is not an account and it is not a signup. `next.config.ts` sets `output: "export"`, so this whole
 * app is static files with no server behind them. There is nowhere for a profile to be sent, nothing to
 * authenticate against, and no record of anyone anywhere. What is collected lives in this browser's
 * `localStorage` and is deleted by a button on this page.
 *
 * The page says so, twice, in the reader's own terms. That is not modesty. A form that looks like a signup
 * teaches a reader that their details went somewhere, and the entire product is an argument about the
 * difference between a claim and a reading -- so a form here that implied a server would be the most
 * expensive possible place to be loose with the truth.
 *
 * ## Why there is no email field
 *
 * Because there is nothing to send. An email box would be the clearest single example of the lie above,
 * and `lib/settings.ts` has a test asserting no contact field ever reaches storage.
 *
 * ## Why this is not a `<form>`
 *
 * The layout's CSP sets `form-action 'none'`, and its comment explains that the directive is meaningful
 * *because* this app has no forms -- so any form that appears in the DOM did not come from us and cannot
 * post anywhere. That is a real tripwire against an injected credential-phishing form, and it is worth
 * more than the free Enter-to-submit a `<form>` would have given. Enter is wired up by hand instead, and
 * `settings-panel.tsx` and `account-control.tsx` already take inputs the same way.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useIdentity } from "@/components/identity";
import { Reveal } from "@/components/motion";
import { useSettings } from "@/components/settings";
import { StageHeader } from "@/components/start";
import { Button, Card, HashChip, Pill, cx } from "@/components/ui";
import { STAGE_ROUTE } from "@/lib/flow";
import { DISPLAY_NAME_MAX, PROFILE_ROLES, isAllowedDisplayName } from "@/lib/settings";
import type { ProfileRole } from "@/lib/settings";
import { displayName } from "@/lib/untrusted";

/**
 * What each role means, and what it changes.
 *
 * The second line is the honest justification for asking at all. A profile question that changes nothing
 * is a form for the sake of having one, and this is the only answer here that alters what the reader is
 * shown next -- an owner needs enforcement and approvals, a publisher needs bonds and the badge.
 */
const ROLE_COPY: Record<ProfileRole, { label: string; what: string }> = {
  owner: {
    label: "I hold an account agents spend from",
    what: "Starts you on enforcement and approvals.",
  },
  publisher: {
    label: "I ship skills other people approve",
    what: "Starts you on bonds and the badge.",
  },
  reviewer: {
    label: "I vouch for other people's releases",
    what: "Starts you on publishers and equivocation.",
  },
  looking: {
    label: "Just looking",
    what: "Nothing is tailored. Everything stays reachable.",
  },
};

export default function ProfilePage() {
  const { address } = useIdentity();
  const { settings, update, clear } = useSettings();
  const router = useRouter();

  const [name, setName] = useState(settings.profile?.displayName ?? "");
  const [org, setOrg] = useState(settings.profile?.org ?? "");
  const [role, setRole] = useState<ProfileRole>(settings.profile?.role ?? "owner");

  const valid = isAllowedDisplayName(name);

  const save = () => {
    if (!valid) return;
    const trimmedOrg = org.trim();
    update({
      profile: {
        displayName: name.trim(),
        role,
        ...(trimmedOrg === "" ? {} : { org: trimmedOrg }),
      },
    });
    router.push(STAGE_ROUTE.onboarding);
  };

  /*
   * Skipping writes a profile rather than bypassing the step.
   *
   * `stageFor` treats a missing profile as "not finished", so leaving without one would land the reader
   * back here on their next navigation -- a skip button that does not skip. Writing the "looking" role
   * with a neutral name is the honest version: the reader really did answer, they answered "just looking".
   */
  const skip = () => {
    update({ profile: { displayName: "Reader", role: "looking" } });
    router.push(STAGE_ROUTE.onboarding);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-4">
      <Reveal>
        <StageHeader step={1} title="Who is reading?">
          Two questions, both optional in effect and neither leaving this browser. The second one changes
          what the dashboard puts in front of you first.
        </StageHeader>
      </Reveal>

      <Reveal delay={0.06}>
        <Card>
          <div className="space-y-7">
            {address === undefined ? null : (
              <div className="flex flex-wrap items-center gap-3 border-b-2 border-line pb-5">
                <Pill tone="bonded">connected</Pill>
                <HashChip value={address} kind="address" emphasis="quiet" />
                <span className="text-xs font-semibold text-faint">
                  Read only. Nothing on this page is signed or sent.
                </span>
              </div>
            )}

            <label className="block space-y-2">
              <span className="shout text-[0.6rem] text-faint">What should we call you</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  // Hand-wired because this is not a form. See the file comment.
                  if (e.key === "Enter" && valid) save();
                }}
                maxLength={DISPLAY_NAME_MAX}
                autoComplete="off"
                spellCheck={false}
                placeholder="Ada"
                className="chunk w-full rounded-lg bg-sunken px-3 py-2.5 text-sm font-semibold text-text"
              />
              <span className="block text-[0.65rem] font-semibold text-faint">
                Used to greet you and nothing else. {name.trim().length}/{DISPLAY_NAME_MAX}
              </span>
            </label>

            <fieldset className="space-y-2">
              <legend className="shout text-[0.6rem] text-faint">
                Which of these is closest
              </legend>

              <div className="space-y-2 pt-1">
                {PROFILE_ROLES.map((option) => {
                  const copy = ROLE_COPY[option];
                  const active = role === option;

                  return (
                    <label
                      key={option}
                      className={cx(
                        "press chunk flex cursor-pointer items-start gap-3 rounded-xl px-4 py-3 transition-colors",
                        active ? "bg-pinned-tint [--line:var(--pinned)]" : "bg-raise hover:bg-panel",
                      )}
                    >
                      {/*
                        A real radio, visually hidden rather than replaced. Arrow-key navigation, the
                        group semantics and the announced state all come free, and a div with
                        role="radio" would have to reimplement every one of them.
                      */}
                      <input
                        type="radio"
                        name="role"
                        value={option}
                        checked={active}
                        onChange={() => setRole(option)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden
                        className={cx(
                          "mt-0.5 block size-4 shrink-0 rounded-pill border-2",
                          active ? "border-pinned-ink bg-pinned" : "border-line-strong",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cx(
                            "block text-sm font-bold",
                            active ? "text-pinned-ink" : "text-text",
                          )}
                        >
                          {copy.label}
                        </span>
                        <span className="mt-0.5 block text-xs font-semibold text-faint">
                          {copy.what}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <label className="block space-y-2">
              <span className="shout text-[0.6rem] text-faint">
                Team or project <span className="text-faint">&mdash; optional</span>
              </span>
              <input
                value={org}
                onChange={(e) => setOrg(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid) save();
                }}
                maxLength={DISPLAY_NAME_MAX}
                autoComplete="off"
                spellCheck={false}
                placeholder="Kuru"
                className="chunk w-full rounded-lg bg-sunken px-3 py-2.5 text-sm font-semibold text-text"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3 border-t-2 border-line pt-5">
              <Button tone="bonded" onClick={save} disabled={!valid}>
                Continue
              </Button>
              <Button tone="neutral" variant="quiet" onClick={skip}>
                Skip this
              </Button>
            </div>
          </div>
        </Card>
      </Reveal>

      {/*
        The disclosure, in its own panel rather than as a line under the button.

        It is the most important thing on the page and it is the opposite of what a reader expects from a
        form that asks for a name, so it gets the weight of a finding rather than the weight of a footnote.
      */}
      <Reveal delay={0.1}>
        <Card tone="attention">
          <p className="shout text-[0.6rem] text-attention-ink">Where this goes</p>
          <p className="mt-2 measure text-sm leading-relaxed font-semibold text-attention-ink">
            Nowhere. This dashboard is a static export with no server behind it, so there is nothing to
            send to and no account being created. Both answers are written to this browser&rsquo;s local
            storage, they are not attached to your address on chain, and clearing site data removes them.
            That is also why you were not asked for an email &mdash; there would be nothing to do with it.
          </p>

          {settings.profile === undefined ? null : (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t-2 border-attention pt-4">
              <span className="text-xs font-semibold text-attention-ink">
                Stored now: {displayName(settings.profile.displayName, "unnamed")}
              </span>
              <Button
                tone="revoked"
                variant="quiet"
                size="sm"
                onClick={() => {
                  setName("");
                  setOrg("");
                  setRole("owner");
                  /*
                    `clear`, not `update({ profile: undefined })`.

                    The settings provider documents exactly this trap: once a patch has been through a
                    spread, `undefined` cannot be told apart from "leave it alone", so an update would
                    silently keep the profile while the button reported success. Removal is its own
                    operation for that reason.
                  */
                  clear("profile");
                }}
              >
                Delete it
              </Button>
            </div>
          )}
        </Card>
      </Reveal>
    </div>
  );
}
