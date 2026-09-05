import type { Metadata } from "next";

/*
 * `Field` used to be rendered here, directly under ThemeProvider.
 *
 * It is a `fixed inset-0 z-0` dot grid, which meant two things at once: it painted above the background of
 * any non-positioned page wrapper, and it read the root theme's tokens. The landing page paints its own
 * near-black ground inside a `.clinical` scope, so the grid drew the light theme's `--line-strong`
 * (#d8d8d8) as light dots on top of #08090a -- a loud speckle over the darkest surface in the product.
 *
 * It now lives inside `components/chrome.tsx`, which already knows the route and already steps aside on the
 * landing page. See the note there.
 */
import { Chrome } from "@/components/chrome";
import { SnapshotProvider } from "@/components/data";
import { FlowGate } from "@/components/flow-gate";
import { IdentityProvider } from "@/components/identity";
import { VisitTracker } from "@/components/quickstart";
import { SettingsProvider } from "@/components/settings";
import { THEME_SCRIPT, ThemeProvider } from "@/components/theme";
import { RAIL_SCRIPT } from "@/lib/rail";

import "./globals.css";

export const metadata: Metadata = {
  title: "Lockstep — a lockfile for agent money",
  description:
    "Every fund-moving call is bound to the exact skill version the account owner approved, enforced on chain at settlement and backed by publisher bonds.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Sets the theme class before first paint.
          
          This has to be a blocking inline script in <head>. React runs after the browser has
          already painted, so doing it in an effect means a white flash on every load for anyone
          using dark mode. suppressHydrationWarning above is required because this script mutates
          the class on <html> before React hydrates and would otherwise be reported as a mismatch.
        */}
        {/*
          A CSP in markup, because a static export has no response to put a header on.

          Deliberately not claiming to be XSS-proof: `script-src` needs `'unsafe-inline'` for Next's
          own bootstrap and for the theme script below, and a static export cannot use nonces since a
          nonce must be minted per response. What it does buy is genuine. `object-src 'none'` kills
          plugin embeds. `base-uri 'none'` blocks base-tag injection, which would silently repoint
          every relative URL on the page. `form-action 'none'` is meaningful precisely because this app
          has no forms, so any that appear are not ours.

          Three protections cannot be expressed here at all -- `frame-ancestors`, `X-Frame-Options` and
          `Referrer-Policy` are header-only -- so a real deployment has to set them at the host.
          `scripts/serve-export.mjs` sets all of them, and is the reference for what a host should send.
        */}
        <meta
          httpEquiv="Content-Security-Policy"
          content={[
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "font-src 'self'",
            "connect-src 'self' https:",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
          ].join("; ")}
        />
        <meta name="referrer" content="no-referrer" />

        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />

        {/*
          Sets the navigation rail's width before first paint, for the same reason as the theme above.

          Both read a stored preference that React cannot see until it runs, and React runs after the first
          paint. Deferred to an effect, a reader who collapsed the rail watches every page render at 224px
          and then snap to 56px — a 168px lurch on every navigation. See lib/rail.ts.
        */}
        <script dangerouslySetInnerHTML={{ __html: RAIL_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        {/*
          A skip link, because the rail is a dozen tab stops and this app is meant to be read.

          Offset past the rail from `lg`, and the offset is back because the rail is back. Pinned to
          `left-6` it renders underneath the fixed sidebar on exactly the screens where that sidebar
          exists, which is the one case a skip link has to work for: a keyboard user on a wide screen
          who does not want to tab through seven nav items to reach the page.

          `calc()` rather than a second variable, so collapsing the rail moves the link with it.
        */}
        <a
          href="#main"
          className="sr-only rounded-md bg-text px-4 py-2 text-sm font-bold text-bg focus:not-sr-only focus:absolute focus:top-6 focus:left-6 focus:z-[60] lg:focus:left-[calc(var(--rail)+1.5rem)]"
        >
          Skip to content
        </a>

        <ThemeProvider>

          {/*
            The provider order is the dependency order, outermost first.

            Settings are read by the snapshot -- RPC URL, account, deploy block -- so they sit above
            it. Identity is above it for the same reason: a connected wallet decides whose approvals
            are shown. Neither reads chain state, and that direction should stay one-way.
          */}
          <SettingsProvider>
            <IdentityProvider>
              <SnapshotProvider>
                {/*
                  Records visits to the routes the quickstart tracks. Mounted here rather than per page
                  so adding a route to VISIT_STEPS starts counting without anyone wiring it up.
                */}
                <VisitTracker />

                {/*
                  Moves a first-time reader through landing, profile and onboarding before the dashboard.

                  Mounted here for the same reason as the tracker above, and renders nothing. It is a
                  redirect rather than a permission — a static export cannot gate a file request — and
                  components/flow-gate.tsx is explicit about that so the distinction survives.
                */}
                <FlowGate />

                {/*
                  The shell: rail, source banner, main and footer.

                  Moved into a client component because the rail has to disappear while a reader is still
                  in the first-run flow. It rendered on the landing page and the gate bounces a mid-flow
                  reader off product routes, so together they made the rail a trap — links a first-time
                  visitor could see, click, and be silently returned from. components/chrome.tsx carries
                  the reasoning and what stays visible regardless.
                */}
                <Chrome>{children}</Chrome>
              </SnapshotProvider>
            </IdentityProvider>
          </SettingsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
