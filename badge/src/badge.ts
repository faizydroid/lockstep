/**
 * Embeddable pin badge.
 *
 * The free tier is the distribution engine. Pinning costs a publisher nothing, and a
 * pinned publisher has a direct commercial reason to display the fact, because
 * "pinned and bonded" converts better than an unverified skill. The badge links back,
 * so publishers market the mechanism without being asked to.
 *
 * SVG rather than a hosted image: it renders in a README, needs no runtime, and
 * cannot phone home. That last point matters for a supply-chain security product —
 * a badge that beacons on every page view would be indefensible.
 */

export type BadgeState =
  | "bonded"
  | "pinned"
  | "unpinned"
  | "revoked"
  | "equivocated";

export interface BadgeInput {
  readonly state: BadgeState;
  /** Bond in whole units of the bond asset, already scaled. */
  readonly bondWholeUnits?: number;
  readonly capabilityCount?: number;
  readonly highRiskCount?: number;
}

interface Palette {
  readonly label: string;
  readonly value: string;
  readonly colour: string;
}

/**
 * Colours are chosen so state is legible without relying on hue alone: the wording
 * carries the meaning too. A red/green-only badge is useless to a colour-blind
 * reviewer, and this is a security signal.
 */
function palette(input: BadgeInput): Palette {
  switch (input.state) {
    case "bonded": {
      const bond = input.bondWholeUnits ?? 0;
      const risk = input.highRiskCount ?? 0;
      // A bonded skill that declares allowance-granting power is not simply "safe",
      // and the badge must not imply that. Amber, and it says so.
      return risk > 0
        ? { label: "lockstep", value: `bonded ${bond} · ${risk} high risk`, colour: "#b45309" }
        : { label: "lockstep", value: `bonded ${bond}`, colour: "#047857" };
    }
    case "pinned":
      return { label: "lockstep", value: "pinned, no bond", colour: "#0369a1" };
    case "unpinned":
      return { label: "lockstep", value: "not pinned", colour: "#6b7280" };
    case "revoked":
      return { label: "lockstep", value: "revoked by publisher", colour: "#b91c1c" };
    case "equivocated":
      // The worst state there is, and it must look like it: the publisher has been
      // caught making conflicting claims about one version and lost a bond for it.
      return { label: "lockstep", value: "publisher slashed", colour: "#7f1d1d" };
  }
}

/** Approximate width of a string in a 11px sans-serif, in pixels. */
function textWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (/[iIl1.,:;'|]/.test(char)) width += 3;
    else if (/[fjrt ]/.test(char)) width += 4.5;
    else if (/[A-Z@%]/.test(char)) width += 8;
    else if (/[mwMW]/.test(char)) width += 9.5;
    else width += 6.5;
  }
  return Math.ceil(width);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderBadge(input: BadgeInput): string {
  const { label, value, colour } = palette(input);
  const padding = 7;
  const labelWidth = textWidth(label) + padding * 2;
  const valueWidth = textWidth(value) + padding * 2;
  const total = labelWidth + valueWidth;
  const height = 20;

  // The accessible name states the meaning, not just the text, because a screen
  // reader user gets no benefit from the colour.
  const accessibleName = `Lockstep: ${value}`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${height}"`,
    ` role="img" aria-label="${escapeXml(accessibleName)}">`,
    `<title>${escapeXml(accessibleName)}</title>`,
    `<linearGradient id="s" x2="0" y2="100%">`,
    `<stop offset="0" stop-color="#fff" stop-opacity=".7"/>`,
    `<stop offset=".1" stop-color="#aaa" stop-opacity=".1"/>`,
    `<stop offset=".9" stop-color="#000" stop-opacity=".3"/>`,
    `<stop offset="1" stop-color="#000" stop-opacity=".5"/>`,
    `</linearGradient>`,
    `<clipPath id="r"><rect width="${total}" height="${height}" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
    `<rect width="${labelWidth}" height="${height}" fill="#334155"/>`,
    `<rect x="${labelWidth}" width="${valueWidth}" height="${height}" fill="${colour}"/>`,
    `<rect width="${total}" height="${height}" fill="url(#s)"/>`,
    `</g>`,
    `<g fill="#fff" text-anchor="middle"`,
    ` font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">`,
    `<text x="${labelWidth / 2}" y="15" fill="#000" fill-opacity=".3">${escapeXml(label)}</text>`,
    `<text x="${labelWidth / 2}" y="14">${escapeXml(label)}</text>`,
    `<text x="${labelWidth + valueWidth / 2}" y="15" fill="#000" fill-opacity=".3">${escapeXml(value)}</text>`,
    `<text x="${labelWidth + valueWidth / 2}" y="14">${escapeXml(value)}</text>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

/** Markdown snippet a publisher can paste into a README. */
export function badgeMarkdown(badgeUrl: string, linkUrl: string, alt = "Lockstep pin status"): string {
  return `[![${alt}](${badgeUrl})](${linkUrl})`;
}

/**
 * Where the badge lives, and why it is a file rather than a URL.
 *
 * The badge is an SVG that cannot phone home, and that constraint decides the shape of everything
 * below. A hosted badge — `https://lockstep.dev/badge/<pin>.svg` in an `<img>` — would report every
 * README view to whoever runs the host: which repositories carry a pin, how often they are read, and
 * from where. For a supply-chain security product that is a map of its own users' security posture,
 * served to a third party. So there is no badge host, and there is not going to be one.
 *
 * What replaces it is duller and better: the publisher commits the SVG into their own repository and
 * references it with a relative path. GitHub renders it, nobody learns anything, and the badge cannot
 * go stale in a way that lies — it is a snapshot of the pin at publish time, and the link beside it
 * goes to the live registry where the current answer is.
 *
 * That last part is the whole reason the link exists. A badge nobody can check is decoration.
 */

/**
 * Conventional filename. One per skill, so a repo publishing several does not collide.
 *
 * `.` is deliberately not in the safe set even though it is legal in a filename. Allowing it produced
 * `lockstep-..-..-etc-passwd.svg` for a name of `../../etc/passwd` — harmless, since there are no
 * separators left to traverse with, and still a filename nobody should be asked to explain. Letters,
 * digits and dashes only, and the extension is appended rather than preserved.
 */
export function badgeFileName(skillName: string): string {
  // Anything outside the safe set becomes a dash: this string becomes a path and a markdown URL.
  const slug = skillName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return `lockstep-${slug === "" ? "pin" : slug}.svg`;
}

/**
 * Strips a skill name down to something safe to put in markdown alt text.
 *
 * This closed a real hole rather than hardening a hypothetical one, and the test that found it is in
 * `badge/test/badge.test.ts`. `badgeSnippet` interpolated the raw name into the alt text, so a skill
 * called `evil](https://phish.example)(` terminated the markdown link early and injected a second,
 * attacker-chosen link into whatever README the snippet was pasted into. The publisher would have
 * pasted it themselves, from output they had every reason to trust.
 *
 * `]`, `[`, `(` and `)` are the characters that matter; the rest are removed because a badge alt text
 * has no need of them and an allowlist is easier to be sure about than a blocklist.
 */
export function safeAltText(skillName: string): string {
  const cleaned = skillName.replace(/[^A-Za-z0-9 ._-]+/g, "").trim();
  return cleaned === "" ? "pin" : cleaned;
}

/** The dashboard URL that shows the pin this badge describes. */
export function pinUrl(dashboard: string, pinId: string): string {
  const base = dashboard.replace(/\/+$/, "");
  return `${base}/pins?pin=${pinId}`;
}

export interface BadgeSnippet {
  /** Filename to write the SVG to, relative to the repository root. */
  readonly fileName: string;
  /** Markdown to paste into a README. */
  readonly markdown: string;
  /** Where the badge links to. */
  readonly linkUrl: string;
}

/**
 * The paste-ready block for a freshly published pin.
 *
 * Relative image path, absolute link. The image has to be relative or it phones home; the link has to
 * be absolute because a README is read on github.com and the registry is not there.
 */
export function badgeSnippet(options: {
  readonly skillName: string;
  readonly pinId: string;
  readonly dashboard: string;
}): BadgeSnippet {
  const fileName = badgeFileName(options.skillName);
  const linkUrl = pinUrl(options.dashboard, options.pinId);
  return {
    fileName,
    linkUrl,
    // Alt text goes through safeAltText, not straight in. See the note there: interpolating the raw
    // name let a crafted skill name inject a second link into the publisher's own README.
    markdown: badgeMarkdown(fileName, linkUrl, `Lockstep pin for ${safeAltText(options.skillName)}`),
  };
}
