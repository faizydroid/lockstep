#!/usr/bin/env node
/**
 * Checks what the dashboard build actually produced.
 *
 * A green `next build` proves the code compiled, which is a weaker claim than it looks. It does
 * not prove a page rendered any content, that the fonts were bundled rather than fetched from a
 * CDN at runtime, or that nothing capable of signing has crept into a site whose whole premise is
 * that it cannot sign. Those are the three things worth failing a build over, so they are checked
 * against the emitted files rather than assumed.
 *
 * Run from the repository root, after `npm run build --workspace @lockstep/app`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "app", "out");

/**
 * Strips tags before matching text.
 *
 * Necessary because the hash-diff view deliberately splits a hash into a dimmed shared prefix
 * and a highlighted remainder. Searching raw markup for "0x233f0359" fails on the span boundary
 * between "0x" and "233f0359" -- that is the component doing its job, not a missing value.
 */
function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");
}

/**
 * Phrases that must survive to the exported HTML, per page.
 *
 * Chosen to be load-bearing rather than decorative: each one only appears if the page's data
 * actually reached its components. The two hashes on the overview are the ones from the live
 * end-to-end run, and their difference is the entire product.
 */
const PAGES = {
  /*
   * "Integrity" and "Bond coverage" prove the scoreboard rendered its derived figures rather than just
   * its frame, and the "of" phrases prove the denominators reached the page -- a ring showing a
   * percentage with no denominator is the failure mode that check exists for.
   *
   * The mascot is matched on `aria-label="Guard`, the spoken label, rather than on any particular
   * wording. That is the path by which the verdict reaches a screen reader, so it is the part worth
   * failing a build over; the drawing is decoration. Matching a specific sentence would tie this
   * script to whichever mood the fixtures happen to produce.
   */
  index: [
    "A lockfile for agent money",
    "Live pins",
    "233f0359",
    "1eac5d90",
    "NOT_PINNED",
    "Integrity",
    "Bond coverage",
    "approved skills still match",
    'aria-label="Guard',

    /*
     * The gate's teaching scaffolding.
     *
     * A reader told me the first version of that panel was incomprehensible, and the fix was almost
     * entirely words: naming the three stations, giving the switch its missing subject (the
     * publisher), numbering the steps, and replacing "attested" with "the code that is asking".
     * None of that is load-bearing for the build, which is exactly why it needs a test -- a refactor
     * that tidied the labels away would leave a panel that renders perfectly and explains nothing.
     */
    "Choose what the publisher ships",
    "The publisher ships",
    "The skill",
    "the code you approved",
    "the code that is asking",
    "Settlement",
  ],
  pins: ["Published pins", "kuru-quote"],
  drift: ["What changed since you approved it", "Gained", "Dropped", "approve(address,uint256)"],
  approvals: ["Approved versions", "read only", "The executor is not the account"],
  publishers: ["Publishers", "Challenger reward", "equivocat"],
  bonds: ["What a pin costs to publish", "Declared capabilities", "Bond required"],
  badge: ["The badge", "Paste into a README", "Why amber exists"],
};

/*
 * Nunito for interface and body, Baloo 2 for display, JetBrains Mono for hashes.
 *
 * The mono face is the one that matters most and is deliberately not round: this app's core content
 * is 66-character hashes a reader compares by eye, and a rounded mono blurs 0/O and 1/l exactly where
 * a misread means approving the wrong bytes.
 */
const FONT_FAMILIES = ["nunito", "baloo", "jetbrains"];

function fontFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) fontFiles(path, acc);
    else if (/\.(woff2?|ttf)$/i.test(name)) acc.push(name);
  }
  return acc;
}

/**
 * Both themes, and the script that stops the wrong one flashing.
 *
 * The flash is the failure mode worth guarding. React runs after first paint, so a theme applied in
 * an effect shows a white page to every dark-mode visitor on every load. The fix is a blocking
 * inline script in <head>, and the only way to know it survived a refactor is to look for it in the
 * emitted HTML.
 *
 * The light and dark values are checked in the stylesheet rather than by rendering, since a static
 * export has no browser to ask. What matters is that both blocks exist and disagree -- a `.dark`
 * rule that redefined nothing would leave the toggle inert.
 */
function checkTheming(index, problems) {
  process.stdout.write("\ntheming\n");

  const hasScript = /classList\.toggle\('dark'/.test(index) || /classList\.toggle\("dark"/.test(index);
  process.stdout.write(`  pre-paint theme script  ${hasScript ? "ok" : "MISSING"}\n`);
  if (!hasScript) {
    problems.push("no inline pre-paint theme script, so the wrong theme will flash on load");
  }

  const cssLinks = [...index.matchAll(/href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]);
  const css = cssLinks
    .map((href) => {
      const file = join(OUT, href.replace(/^\//, "").split("?")[0]);
      return existsSync(file) ? readFileSync(file, "utf8") : "";
    })
    .join("\n");

  if (css === "") {
    problems.push("no stylesheet was found in the export");
    return;
  }

  // The dark variant has to be class-driven, not media-driven, or the toggle cannot override the OS.
  const classDriven = /\.dark/.test(css);
  process.stdout.write(`  class-driven dark rules ${classDriven ? "ok" : "MISSING"}\n`);
  if (!classDriven) problems.push("the stylesheet has no .dark rules, so the theme cannot be toggled");

  const valueOf = (block, token) =>
    new RegExp(`${block}\\s*\\{[^}]*${token}:\\s*([^;]+);`).exec(css)?.[1]?.trim();

  // Grounds and inks must be defined twice with different values, or the toggle does nothing.
  for (const token of ["--bg", "--panel", "--text", "--faint", "--bonded-ink", "--revoked-tint"]) {
    const light = valueOf(":root", token);
    const dark = valueOf("\\.dark", token);
    const differ = light !== undefined && dark !== undefined && light !== dark;
    process.stdout.write(
      `  ${token.padEnd(23)} ${differ ? `ok  ${light} / ${dark}` : "NOT THEMED"}\n`,
    );
    if (!differ) problems.push(`${token} is not defined differently for light and dark`);
  }

  /*
   * The bright brand faces must be IDENTICAL across themes, which is the opposite assertion.
   *
   * This is a real design decision worth locking down rather than an omission. Duolingo's hues are
   * saturated enough to hold up on either ground, so a green button is the same green in both themes
   * and only the text inks and the undersides move. An earlier version of this check required every
   * status token to differ per theme, which was correct for the previous muted palette and would now
   * fail the build for doing the right thing.
   */
  for (const token of ["--bonded", "--pinned", "--attention", "--revoked", "--equivocated"]) {
    const light = valueOf(":root", token);
    const dark = valueOf("\\.dark", token);
    const same = light !== undefined && light === dark;
    process.stdout.write(`  ${token.padEnd(23)} ${same ? `ok  ${light} both themes` : "DRIFTED"}\n`);
    if (!same) {
      problems.push(`${token} should be the same bright face in both themes, got ${light} / ${dark}`);
    }
  }

  /*
   * --on-face carries the label on every solid fill in the app.
   *
   * It exists because white-on-Feather-Green measures 2.09:1, a real AA failure in Duolingo's own
   * product. Near-black on the same unmodified hue measures 4.99 to 10.61. If this token ever goes
   * missing the buttons fall back to inheriting body colour and the contrast work silently unwinds,
   * so its presence is a build requirement and it must NOT be themed.
   */
  const onFace = valueOf(":root", "--on-face");
  const onFaceDark = valueOf("\\.dark", "--on-face");
  const onFaceOk = onFace !== undefined && onFaceDark === undefined;
  process.stdout.write(
    `  --on-face               ${onFaceOk ? `ok  ${onFace}, not themed` : "MISSING or themed"}\n`,
  );
  if (!onFaceOk) {
    problems.push(
      "--on-face must be defined at :root and not overridden under .dark, since the fills it sits on are identical in both themes",
    );
  }

  /*
   * The signature surface, checked because it is the whole visual identity.
   *
   * `.pop` compiles to an inset 2px border plus a hard, un-blurred `0 4px 0` underside. If a refactor
   * turned it into an ordinary blurred shadow the app would still build and would stop looking like
   * itself, so the emitted rule is matched rather than trusted.
   */
  const hasPop = /inset 0 0 0 2px var\(--line\)/.test(css) && /0 4px 0 0 var\(--pop\)/.test(css);
  process.stdout.write(`  hard 4px underside      ${hasPop ? "ok" : "MISSING"}\n`);
  if (!hasPop) problems.push("the .pop utility did not emit its 2px border and hard 4px underside");

  // Utilities must compile to the raw variable, not to an indirection resolved once at :root.
  // Without `@theme inline` they read var(--color-panel), whose value is substituted at :root and
  // inherited, and redefining --panel under .dark would then change nothing.
  const inlined = /var\(--panel\)/.test(css);
  process.stdout.write(`  tokens resolve live     ${inlined ? "ok" : "INDIRECT"}\n`);
  if (!inlined) {
    problems.push("utilities do not reference the theme variables directly; @theme inline is needed");
  }
}

/**
 * What the shipped bundle is able to sign.
 *
 * This replaced a blanket ban on wallet surfaces. That check tested for `window.ethereum`,
 * `eth_requestAccounts` and `walletConnect`, and it was the right check while the dashboard was
 * read-only -- but it tested the wrong thing. It asked whether a wallet was present, when what matters
 * is which calls can be encoded. Once the dashboard gained a connect flow and three narrowing writes,
 * the old check would have failed the build for a feature that is safe, while never having verified the
 * thing that actually is not.
 *
 * The invariant, from lib/policy.ts: a browser may send a transaction whose correctness the contract
 * can check from its own state, and may not send one that asserts a fact about bytes on a disk. The
 * three that assert such a fact are `approvePin`, `publish` and `execute`.
 *
 * Enforced through viem's encoding model. viem builds calldata from an ABI fragment, so a fragment
 * that is not in the bundle is a call the client cannot make -- not a call it has been asked politely
 * not to make. Object literal keys survive minification because they are data, so a fragment that
 * exists is findable as `name:"approvePin"` in the emitted chunks.
 *
 * Both directions are checked. Absence of the forbidden three, and presence of the three that are
 * wired, because a bundle with no write fragments at all would satisfy a one-sided check while
 * silently shipping a dashboard whose buttons do nothing.
 */
/** Every emitted JS chunk, concatenated. The bundle is where client-only wiring is visible. */
function readBundle() {
  const chunks = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".js")) chunks.push(readFileSync(path, "utf8"));
    }
  };
  walk(OUT);
  return chunks.join("\n");
}

function checkWriteBoundary(problems) {
  process.stdout.write("\nwrite boundary\n");

  const bundle = readBundle();

  if (bundle === "") {
    problems.push("no JavaScript chunks were found in the export");
    return;
  }

  /** Matches an ABI fragment's name field, tolerating minified spacing and either quote style. */
  const fragment = (fn) => new RegExp(`name\\s*:\\s*["']${fn}["']`);

  const FORBIDDEN = ["approvePin", "publish", "execute"];
  for (const fn of FORBIDDEN) {
    const present = fragment(fn).test(bundle);
    process.stdout.write(`  ${fn.padEnd(20)} ${present ? "PRESENT -- must not be" : "absent, ok"}\n`);
    if (present) {
      problems.push(
        `the bundle carries an ABI fragment for ${fn}, which asserts a fact about bytes and must stay out of the browser`,
      );
    }
  }

  const WIRED = ["unapprovePin", "revokeExecutor", "slashEquivocation"];
  for (const fn of WIRED) {
    const present = fragment(fn).test(bundle);
    process.stdout.write(`  ${fn.padEnd(20)} ${present ? "present, ok" : "MISSING"}\n`);
    if (!present) {
      problems.push(`${fn} is an allowed write but no ABI fragment reached the bundle`);
    }
  }

  /*
   * The footer states the boundary to the reader.
   *
   * Checked because it is the only place a visitor learns why there is no approve button, and a
   * refactor that drops it turns a deliberate design decision into an apparent missing feature.
   */
  const index = readFileSync(join(OUT, "index.html"), "utf8");
  const stated = textOf(index).includes("Approving a skill version happens in the CLI");
  process.stdout.write(`  boundary stated in UI  ${stated ? "ok" : "MISSING"}\n`);
  if (!stated) problems.push("the export does not tell the reader that approving happens in the CLI");
}

/**
 * The ERC-8004 reviewer panel, checked in the bundle rather than in the HTML.
 *
 * It cannot be checked in the exported markup, and the reason is worth writing down: the panel
 * renders from a chain read that happens in the browser, and it renders nothing at all unless a
 * `LockstepLens` is configured and answering. So the static HTML is correctly empty here, and
 * grepping `publishers.html` for it would fail while everything worked.
 *
 * What the bundle can prove is that the wiring shipped: the ABI fragments the Lens needs, the
 * configuration key that switches it on, and -- most importantly -- the caveat copy. That last one
 * is the check with teeth. A Sybil filter that excludes nobody renders as a column of green pills,
 * which reads as the filter working, and on the live deployment the only candidate is also the only
 * publisher. If the honest disclaimer is dropped in a refactor the interface starts overclaiming,
 * which is the exact failure this product exists to prevent, one layer up.
 */
function checkLensWiring(problems) {
  process.stdout.write("\nERC-8004 reviewer panel\n");

  const bundle = readBundle();
  if (bundle === "") {
    problems.push("no JavaScript chunks were found in the export");
    return;
  }

  const fragment = (fn) => new RegExp(`name\\s*:\\s*["']${fn}["']`);

  // The reads the panel makes. Without a fragment viem cannot encode the call, and the panel
  // renders nothing rather than failing loudly.
  for (const fn of ["eligibleReviewers", "isEligibleReviewer", "weightedScore", "unfilteredScore"]) {
    const present = fragment(fn).test(bundle);
    process.stdout.write(`  ${fn.padEnd(22)} ${present ? "present, ok" : "MISSING"}\n`);
    if (!present) {
      problems.push(`the bundle has no ABI fragment for ${fn}, so the reviewer panel cannot read it`);
    }
  }

  /*
   * `NEXT_PUBLIC_*` values are inlined at build time, so an unset one leaves no trace at all. The
   * switch is therefore checked by looking for the deployed address itself, case-insensitively:
   * minifiers preserve string contents, but the source and the chain disagree on EIP-55 casing.
   */
  const lensWired = /0x3338c4f5c8eefeacf8e41d6ac47b63c466175664/i.test(bundle);
  process.stdout.write(`  lens address inlined   ${lensWired ? "ok" : "NOT CONFIGURED"}\n`);
  if (!lensWired) {
    problems.push(
      "NEXT_PUBLIC_LOCKSTEP_LENS is not in the bundle, so the deployed dashboard will not read the Lens",
    );
  }

  // The honesty, and the reason this function exists.
  const caveats = [
    "vouching for its own release",
    "removes nothing looks identical to no filter",
    "registering an agent is the publisher's own act",
  ];
  for (const phrase of caveats) {
    const present = bundle.includes(phrase);
    process.stdout.write(`  caveat ${phrase.slice(0, 34).padEnd(35)} ${present ? "ok" : "MISSING"}\n`);
    if (!present) {
      problems.push(
        `the bundle no longer carries the caveat "${phrase}", so the reviewer panel can overclaim`,
      );
    }
  }
}

function main() {
  if (!existsSync(OUT)) {
    process.stderr.write(
      `no export at ${OUT}\nRun: npm run build --workspace @lockstep/app\n`,
    );
    return 1;
  }

  const problems = [];

  for (const [page, needles] of Object.entries(PAGES)) {
    const file = join(OUT, `${page}.html`);
    if (!existsSync(file)) {
      problems.push(`${page}.html was not exported`);
      continue;
    }

    const raw = readFileSync(file, "utf8");
    const text = textOf(raw);
    const missing = needles.filter((needle) => !text.includes(needle) && !raw.includes(needle));
    const kb = Math.round(statSync(file).size / 1024);

    if (missing.length > 0) {
      problems.push(`${page}.html is missing: ${missing.join(", ")}`);
      process.stdout.write(`thin  ${page.padEnd(11)} ${String(kb).padStart(4)}KB\n`);
    } else {
      process.stdout.write(`ok    ${page.padEnd(11)} ${String(kb).padStart(4)}KB\n`);
    }
  }

  const fonts = fontFiles(OUT);
  process.stdout.write(`\nfont files emitted: ${fonts.length}\n`);
  for (const family of FONT_FAMILIES) {
    const present = fonts.some((f) => f.toLowerCase().includes(family));
    process.stdout.write(`  ${family.padEnd(11)} ${present ? "ok" : "MISSING"}\n`);
    if (!present) problems.push(`no ${family} font file was emitted`);
  }

  const index = readFileSync(join(OUT, "index.html"), "utf8");

  // Self-hosted fonts are the point: the build stays reproducible offline, and a page that
  // fetched fonts from a third party at runtime would be hard to defend in a product about
  // supply-chain provenance.
  if (/https:\/\/fonts\.(googleapis|gstatic)\.com/.test(index)) {
    problems.push("the export requests fonts from a remote CDN");
  }

  checkWriteBoundary(problems);

  checkLensWiring(problems);

  checkTheming(index, problems);

  if (problems.length > 0) {
    process.stderr.write(`\n${problems.length} problem(s):\n`);
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    return 1;
  }

  process.stdout.write("\nexport looks good\n");
  return 0;
}

process.exit(main());
