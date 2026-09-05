import Link from "next/link";

/**
 * The 404 page, which did not exist.
 *
 * It matters more here than on most sites. This is a static export, so every route is a file and any path
 * that is not one is reachable — a mistyped `/pin`, a stale link to a renamed route, or a host that does not
 * rewrite unknown paths. Without this the reader got whatever the host serves by default, which is usually a
 * bare server error with no way back into the product.
 *
 * A server component: there is nothing to read and nothing to interact with, so it ships no JavaScript.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center gap-6 px-5 py-16">
      <div className="space-y-3">
        <p className="shout text-label text-faint">404</p>
        <h1 className="font-display text-3xl leading-tight text-text">
          There is nothing at this address
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          The page you asked for is not part of this app. Nothing is wrong with the registry &mdash; this is a
          routing miss, not a failed read.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/"
          className="press inline-flex h-10 items-center rounded-md bg-bonded px-4 text-sm font-medium text-on-face"
        >
          Back to the front page
        </Link>
        <Link
          href="/dashboard"
          className="press inline-flex h-10 items-center rounded-md border border-line-strong px-4 text-sm font-medium text-text hover:bg-raise"
        >
          Go to the dashboard
        </Link>
      </div>
    </div>
  );
}
