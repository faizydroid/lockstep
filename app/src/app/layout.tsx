import type { Metadata } from "next";

import { SnapshotProvider } from "@/components/data";
import { Field } from "@/components/field";
import { IdentityProvider } from "@/components/identity";
import { Nav } from "@/components/nav";
import { RouteShell } from "@/components/route-shell";
import { SettingsProvider } from "@/components/settings";
import { SourceBanner } from "@/components/source-banner";
import { THEME_SCRIPT, ThemeProvider } from "@/components/theme";

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
      </head>
      <body className="min-h-dvh antialiased">
        {/*
          A skip link, because the rail is a dozen tab stops and this app is meant to be read.

          Offset past the rail from `lg`. Pinned to `left-6` it appeared underneath a fixed 272px
          sidebar on exactly the screens where the rail exists, which is the one case where a skip
          link has to work: a keyboard user on a wide screen tabbing past seven nav items.
        */}
        <a
          href="#main"
          className="sr-only rounded-md bg-text px-4 py-2 text-sm font-bold text-bg focus:not-sr-only focus:absolute focus:top-6 focus:left-6 focus:z-[60] lg:focus:left-[calc(var(--rail)+1.5rem)]"
        >
          Skip to content
        </a>

        <ThemeProvider>
          <Field />

          {/*
            The provider order is the dependency order, outermost first.

            Settings are read by the snapshot -- RPC URL, account, deploy block -- so they sit above
            it. Identity is above it for the same reason: a connected wallet decides whose approvals
            are shown. Neither reads chain state, and that direction should stay one-way.
          */}
          <SettingsProvider>
            <IdentityProvider>
              <SnapshotProvider>
                <Nav />

                {/*
                  Offset by the rail's width, and only from `lg`.

                  The rail is `fixed`, so it is out of flow and content would otherwise run underneath
                  it. Padding on this wrapper rather than a margin on <main> keeps the banner and
                  footer in the same column as the content, which matters because all three use the
                  full-bleed `.gutter` and would otherwise disagree about where the page starts.
                */}
                <div className="lg:pl-[var(--rail)]">
                  <SourceBanner />

                  {/*
                    `pt-5`, was `pt-8`. The banner already contributes its own top padding, so the
                    two stacked to 48px of nothing between the chrome and the first real element on
                    every page.
                  */}
                  <main id="main" className="gutter relative z-10 w-full pb-24 pt-5">
                    <RouteShell>{children}</RouteShell>
                  </main>

                  <footer className="gutter relative z-10 w-full pb-12">
                    <div className="chunk rounded-xl bg-raise px-6 py-5 text-xs leading-relaxed font-semibold text-faint">
                      Approving a skill version happens in the CLI, never here. An approval is a claim
                      about exact bytes, and only the machine holding those bytes can make it honestly
                      &mdash; a web page asking you to sign a hash it fetched is the shape of the
                      attack this project exists to stop.
                    </div>
                  </footer>
                </div>
              </SnapshotProvider>
            </IdentityProvider>
          </SettingsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
