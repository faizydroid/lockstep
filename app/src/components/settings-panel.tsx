"use client";

/**
 * Settings.
 *
 * Each control states what it changes and, where it matters, what it cannot change. That is not
 * padding: the registry address is deliberately absent from this panel and a reader who does not know
 * that will assume it is missing by oversight. See `lib/settings.ts` for the rule these follow.
 *
 * Every field validates on the way in and shows why it refused, rather than accepting a value that
 * fails later inside a fetch. A settings panel that swallows a bad RPC URL and then falls back to
 * sample data is the same dishonesty this app is otherwise careful about, one layer down.
 */

import { useState } from "react";
import type { Address } from "viem";

import { Reveal } from "@/components/motion";
import { useSettings } from "@/components/settings";
import { Button, Card, Pill, cx } from "@/components/ui";
import { readConfig } from "@/lib/chain";
import { isAllowedAddress, isAllowedRpcUrl } from "@/lib/settings";
import type { MotionPreference } from "@/lib/settings";

export function SettingsPanel() {
  const { settings, update, clear, reset } = useSettings();
  const build = readConfig();

  return (
    <div className="space-y-6">
      <Reveal>
        <Card>
          <TextSetting
            label="RPC endpoint"
            placeholder={build.rpcUrl}
            value={settings.rpcUrl}
            onSave={(next) => update({ rpcUrl: next })}
            onClear={() => clear("rpcUrl")}
            validate={(candidate) =>
              isAllowedRpcUrl(candidate)
                ? undefined
                : "Needs an https URL, or http on localhost. Credentials in the URL are refused \u2014 a key in localStorage is a key nobody remembers to clear."
            }
            hint="Monad's public endpoint rate-limits hard enough that a real reader wants their own. The chain id is still verified against what the endpoint reports, and an override is disclosed in the bar at the top of every page."
          />
        </Card>
      </Reveal>

      <Reveal delay={0.04}>
        <Card>
          <TextSetting
            label="Account to read"
            placeholder={build.account ?? "0x\u2026"}
            value={settings.account}
            onSave={(next) => update({ account: next as Address })}
            onClear={() => clear("account")}
            validate={(candidate) =>
              isAllowedAddress(candidate)
                ? undefined
                : "Needs a 20-byte hex address. The zero address is refused, since it is the usual way to look configured and not be."
            }
            hint="Whose approvals, executions and delegation to show. Read-only in every sense \u2014 this grants nothing and signs nothing. A connected wallet takes precedence over whatever is set here."
          />
        </Card>
      </Reveal>

      <Reveal delay={0.08}>
        <Card>
          <TextSetting
            label="Log scan start block"
            placeholder={build.deployBlock.toString()}
            value={settings.deployBlock?.toString()}
            onSave={(next) => update({ deployBlock: BigInt(next) })}
            onClear={() => clear("deployBlock")}
            validate={(candidate) => {
              if (!/^\d+$/.test(candidate)) return "Needs a whole block number.";
              return undefined;
            }}
            hint="Where capability and approval log queries begin. Monad's public RPC caps eth_getLogs at a 100-block range, so a value far behind the head means the scan runs out of budget and says so rather than presenting a partial history as complete."
          />
        </Card>
      </Reveal>

      <Reveal delay={0.12}>
        <Card>
          <p className="shout text-label text-faint">Motion</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(
              [
                ["system", "Follow the system", "Respects prefers-reduced-motion, which is the right default."],
                ["full", "Always animate", "Ignores the system setting in the other direction."],
                ["reduced", "Reduce motion", "Cuts transitions and the sliding nav indicator."],
              ] as const
            ).map(([value, label, why]) => (
              <button
                key={value}
                type="button"
                onClick={() => update({ motion: value as MotionPreference })}
                title={why}
                aria-pressed={settings.motion === value}
                className={cx(
                  "shout press rounded-pill px-3.5 py-2 text-label",
                  settings.motion === value
                    ? "pop-sm bg-pinned-tint text-pinned-ink [--line:var(--pinned)] [--pop:var(--pinned-shade)]"
                    : "chunk bg-panel text-muted hover:text-text",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-faint">
            {settings.motion === "system"
              ? "Following the operating system, which is what an accessibility preference is for."
              : "Overriding the operating system's preference for this browser only."}
          </p>
        </Card>
      </Reveal>

      {/*
        The absence that has to be explained.

        A reader who finds RPC and account here will look for the registry, and not finding it will
        read as an oversight rather than as a decision. Saying so converts a missing control into a
        stated position.
      */}
      <Reveal delay={0.16}>
        <Card tone="attention">
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone="attention">not settable</Pill>
            <p className="shout text-label text-faint">The registry address</p>
          </div>
          <p className="mt-3 measure text-sm leading-relaxed text-muted">
            Everything above is transport or presentation. The registry is the one value that decides
            whether anything on this screen is about Lockstep at all, and a panel that could repoint it
            would make this dashboard a convenient way to produce authoritative-looking screenshots of
            a registry that is not this one. It stays a build-time constant, where changing it needs a
            rebuild and leaves a trace.
          </p>
          <p className="mt-3 text-xs font-semibold text-faint">
            Currently reading{" "}
            <code className="hash text-text">{build.registry ?? "nothing \u2014 unconfigured"}</code>
          </p>
        </Card>
      </Reveal>

      <Reveal delay={0.2}>
        <Card className="bg-raise">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-text">Reset everything</p>
              <p className="mt-1 measure text-xs leading-relaxed text-muted">
                Clears overrides, motion preference and quickstart progress. Nothing here is stored
                anywhere but this browser, so there is nothing to reset on a server.
              </p>
            </div>
            <Button onClick={reset} tone="revoked" variant="quiet" size="sm">
              Reset
            </Button>
          </div>
        </Card>
      </Reveal>
    </div>
  );
}

/**
 * One text setting, validated before it is committed.
 *
 * Local draft state rather than writing on every keystroke: persisting mid-typing would fire a chain
 * read against `https://tes` and then against `https://test`, which on a rate-limited endpoint is how
 * a page ends up throttled into sample data.
 */
function TextSetting({
  label,
  placeholder,
  value,
  hint,
  onSave,
  onClear,
  validate,
}: {
  label: string;
  placeholder: string;
  value: string | undefined;
  hint: string;
  onSave: (next: string) => void;
  onClear: () => void;
  validate: (candidate: string) => string | undefined;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);

  const dirty = draft.trim() !== (value ?? "");

  const submit = () => {
    const candidate = draft.trim();
    if (candidate === "") {
      onClear();
      setProblem(undefined);
      setSaved(true);
      return;
    }
    const why = validate(candidate);
    if (why !== undefined) {
      setProblem(why);
      setSaved(false);
      return;
    }
    onSave(candidate);
    setProblem(undefined);
    setSaved(true);
  };

  const id = `setting-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="shout text-label text-faint" htmlFor={id}>
          {label}
        </label>
        {value === undefined ? (
          <Pill tone="neutral">build default</Pill>
        ) : (
          <Pill tone="pinned">overridden</Pill>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          type="text"
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          value={draft}
          placeholder={placeholder}
          aria-invalid={problem !== undefined}
          aria-describedby={problem === undefined ? undefined : `${id}-problem`}
          onChange={(event) => {
            setDraft(event.target.value);
            setProblem(undefined);
            setSaved(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          className={cx(
            "hash chunk min-w-0 flex-1 rounded-xl bg-sunken px-3 py-2 text-sm text-text placeholder:text-faint",
            problem === undefined ? undefined : "[--line:var(--revoked)]",
          )}
        />
        <Button onClick={submit} disabled={!dirty} tone="pinned" size="sm">
          {draft.trim() === "" && value !== undefined ? "Clear" : "Save"}
        </Button>
        {value === undefined ? null : (
          <Button
            onClick={() => {
              onClear();
              setDraft("");
              setProblem(undefined);
              setSaved(true);
            }}
            tone="neutral"
            variant="quiet"
            size="sm"
          >
            Use default
          </Button>
        )}
      </div>

      {problem === undefined ? null : (
        <p id={`${id}-problem`} role="alert" className="text-xs leading-relaxed font-semibold text-revoked-ink">
          {problem}
        </p>
      )}
      {saved && problem === undefined ? (
        <p className="text-xs font-semibold text-bonded-ink">Saved. The next read uses it.</p>
      ) : null}

      <p className="text-xs leading-relaxed text-faint">{hint}</p>
    </div>
  );
}
