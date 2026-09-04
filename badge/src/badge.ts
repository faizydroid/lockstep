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
