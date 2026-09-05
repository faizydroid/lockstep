"use client";

/**
 * The error boundary, which did not exist either.
 *
 * Without one, a throw anywhere in a client component unmounts the whole tree and leaves a blank white page.
 * On a dashboard that reads a chain over an unreliable public RPC that is a realistic outcome, and a blank
 * page is the single worst thing this product can show: a reader cannot tell it apart from the app having
 * decided their account is empty.
 *
 * ## What it says, and what it deliberately does not say
 *
 * It does not apologise and it does not guess. The one thing worth asserting is the thing a reader of a
 * security tool actually wants to know first, and it is true by construction: nothing here writes to a chain
 * without an explicit confirmation and a wallet signature, so a rendering failure cannot have changed any
 * state. Saying that is more useful than "something went wrong".
 *
 * The raw message is shown rather than swallowed, in monospace, because it is the only thing that makes the
 * failure searchable — the same reasoning as the failed-write panel in `write-action.tsx`.
 */

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center gap-6 px-5 py-16">
      <div className="space-y-3">
        <p className="shout text-label text-revoked-ink">Interface error</p>
        <h1 className="font-display text-3xl leading-tight text-text">This page failed to render</h1>
        <p className="text-sm leading-relaxed text-muted">
          Nothing on chain was touched. Every write in this app needs an explicit confirmation and a wallet
          signature, so a failure while drawing a page cannot have changed any state &mdash; your approvals and
          bonds are exactly as they were.
        </p>
      </div>

      <div className="rounded-md border border-line bg-panel p-4">
        <p className="shout text-label text-faint">Reported</p>
        <pre className="mt-2 overflow-x-auto text-label leading-relaxed">
          <code className="hash select-all text-revoked-ink">{error.message || "No message"}</code>
        </pre>
      </div>

      <div className="flex flex-wrap gap-3">
        {/*
          `reset` re-renders the segment rather than reloading, which is worth trying first: most failures here
          would come from one bad read, and a retry costs nothing.
        */}
        <button
          type="button"
          onClick={reset}
          className="press inline-flex h-10 items-center rounded-md bg-bonded px-4 text-sm font-medium text-on-face"
        >
          Try again
        </button>
        <a
          href="/"
          className="press inline-flex h-10 items-center rounded-md border border-line-strong px-4 text-sm font-medium text-text hover:bg-raise"
        >
          Back to the front page
        </a>
      </div>
    </div>
  );
}
