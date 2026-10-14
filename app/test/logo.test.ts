/**
 * The logo, and that everything which shows it is showing the same one.
 *
 * `brand/lockstep-logo.webp` is the owner's file. The dashboard mark, the tab and home-screen icons, the
 * link-preview card and the README header are all derived from it by `scripts/make-logo-assets.mjs`, and
 * there are two ways for them to drift apart: replacing the source without re-running the script, which
 * leaves every derived file on the old logo, and pointing the layout at a file that was never made, which
 * leaves a tab with no icon and no error. Neither shows up in a type check or in the other 540 tests.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(__dirname, "..");
const ROOT = join(APP, "..");
const file = (...parts: string[]) => readFileSync(join(ROOT, ...parts));
const text = (...parts: string[]) => file(...parts).toString("utf8");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), "a PNG signature").toBe(true);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function webpSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (chunk === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  throw new Error(`a webp chunk this test does not read: ${chunk}`);
}

describe("the source logo", () => {
  it("is the owner's file, with a real transparent ground, and not left lying in the app directory", () => {
    const source = file("brand", "lockstep-logo.webp");
    expect(webpSize(source).width).toBeGreaterThan(256);
    expect(existsSync(join(APP, "src", "app", "black_logo.webp"))).toBe(false);
  });

  it("is the one every derived file was made from", () => {
    const record = JSON.parse(text("brand", "assets.json")) as { source: string; sha256: string; derived: string[] };
    const actual = createHash("sha256").update(file(...record.source.split("/"))).digest("hex");
    expect(
      actual,
      "brand/lockstep-logo.webp changed after the derived files were made. Run `node scripts/make-logo-assets.mjs`.",
    ).toBe(record.sha256);
    for (const path of record.derived) expect(existsSync(join(ROOT, ...path.split("/"))), path).toBe(true);
  });
});

describe("the derived files", () => {
  const images: [string, "webp" | "png", number, number][] = [
    ["app/public/logo.webp", "webp", 256, 256],
    ["brand/logo-black.webp", "webp", 512, 512],
    ["brand/logo-white.webp", "webp", 512, 512],
    ["app/public/icon-on-light.png", "png", 64, 64],
    ["app/public/icon-on-dark.png", "png", 64, 64],
    ["app/public/apple-icon.png", "png", 180, 180],
    ["app/public/og.png", "png", 1200, 630],
  ];

  it.each(images)("%s is a %s of %i x %i", (path, kind, width, height) => {
    const bytes = file(...path.split("/"));
    expect(kind === "webp" ? webpSize(bytes) : pngSize(bytes)).toEqual({ width, height });
  });

  it("favicon.ico is an icon holding one 32 x 32 image", () => {
    const bytes = file("app", "public", "favicon.ico");
    expect([...bytes.subarray(0, 6)]).toEqual([0, 0, 1, 0, 1, 0]); // reserved, icon, one image
    expect([bytes[6], bytes[7]]).toEqual([32, 32]);
    expect(bytes.readUInt32LE(18), "the image starts straight after the 22-byte header").toBe(22);
    expect(pngSize(bytes.subarray(22))).toEqual({ width: 32, height: 32 });
  });

  it("the light and dark versions are different files of the same size", () => {
    const black = file("brand", "logo-black.webp");
    const white = file("brand", "logo-white.webp");
    expect(black.equals(white)).toBe(false);
    expect(webpSize(black)).toEqual(webpSize(white));
  });
});

describe("what shows the logo", () => {
  const nav = text("app", "src", "components", "nav.tsx");
  const layout = text("app", "src", "app", "layout.tsx");

  it("the dashboard mark is the logo, inverted on the dark theme", () => {
    const mark = nav.slice(nav.indexOf("export function Mark()"));
    expect(mark).toContain('src="/logo.webp"');
    expect(mark).toContain("dark:invert");
    // Not an <img> with a description: the word beside it already says the name.
    expect(mark).toContain('alt=""');
  });

  it("the layout points at icon files that exist, and at every kind of icon", () => {
    const referenced = [...layout.matchAll(/"(\/[A-Za-z0-9_-]+\.(?:png|ico|webp))"/g)].map((m) => m[1]!);
    expect(new Set(referenced)).toEqual(
      new Set(["/icon-on-light.png", "/icon-on-dark.png", "/favicon.ico", "/apple-icon.png", "/og.png"]),
    );
    for (const path of referenced) expect(existsSync(join(APP, "public", path.slice(1))), path).toBe(true);
  });

  it("the tab icon is chosen by the browser's colour scheme, so a black glyph never lands on a dark tab", () => {
    expect(layout).toMatch(/icon-on-light\.png[^}]*prefers-color-scheme: light/);
    expect(layout).toMatch(/icon-on-dark\.png[^}]*prefers-color-scheme: dark/);
  });

  it("the card is resolved against the real site, not localhost", () => {
    expect(layout).toContain("metadataBase: new URL(LOCKSTEP_DASHBOARD)");
    expect(text("badge", "src", "badge.ts")).toContain('LOCKSTEP_DASHBOARD = "https://lockstep.dofolabs.space"');
  });

  it("the README shows the pair, and both files exist", () => {
    const readme = text("README.md");
    expect(readme).toContain("brand/logo-black.webp");
    expect(readme).toContain("brand/logo-white.webp");
    expect(readme).toMatch(/prefers-color-scheme: dark/);
  });

  it("the local host serves webp as an image, which the export does not do by accident", () => {
    expect(text("scripts", "serve-export.mjs")).toMatch(/"\.webp":\s*"image\/webp"/);
  });
});
