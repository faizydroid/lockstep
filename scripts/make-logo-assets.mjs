/**
 * Builds every logo file from the one the owner supplied.
 *
 *   node scripts/make-logo-assets.mjs
 *
 * `brand/lockstep-logo.webp` is the source of truth: a black glyph on a transparent ground. Everything else
 * is derived from it, so replacing that one file and running this again moves the dashboard mark, the
 * favicons, the social card and the README header together instead of leaving one of them on the old logo.
 *
 * It does not redraw anything. The glyph is cropped to its own bounds, flattened to a single colour, and
 * placed on a canvas; the shape is the owner's. Flattening matters: the source's anti-aliased edge pixels
 * carry the colour of whatever ground the file was exported over, which shows as a light fringe the moment
 * the glyph sits on a dark one.
 *
 * Needs `sharp`, which installs with Next. Output is committed, so nothing else has to run this.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "brand", "lockstep-logo.webp");
const BRAND = join(ROOT, "brand");
const PUBLIC = join(ROOT, "app", "public");

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
/** The landing page's near-black ground, #08090a. */
const NIGHT = [8, 9, 10];

/** The alpha plane of the source, and the box the visible glyph occupies. */
async function readGlyph() {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const alpha = Buffer.alloc(width * height);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = data[(y * width + x) * 4 + 3];
      alpha[y * width + x] = a;
      if (a > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error(`${SOURCE} has no visible pixels`);
  return { alpha, width, height, box: { left, top, width: right - left + 1, height: bottom - top + 1 } };
}

/** The glyph in one flat colour, cropped to its bounds and fitted inside `limit` x `limit`, as PNG. */
async function glyph(g, rgb, limit) {
  const rgba = Buffer.alloc(g.width * g.height * 4);
  for (let i = 0; i < g.alpha.length; i += 1) {
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = g.alpha[i];
  }
  return sharp(rgba, { raw: { width: g.width, height: g.height, channels: 4 } })
    .extract(g.box)
    .resize({ width: limit, height: limit, fit: "inside", kernel: "lanczos3" })
    .png()
    .toBuffer();
}

/** A `size` x `size` canvas with the glyph centred and `pad` (a fraction of `size`) clear on every side. */
async function tile(g, { size, rgb, pad, ground, radius }) {
  const mark = await glyph(g, rgb, Math.round(size * (1 - 2 * pad)));
  const background = ground === undefined
    ? { r: 0, g: 0, b: 0, alpha: 0 }
    : { r: ground[0], g: ground[1], b: ground[2], alpha: 1 };
  let image = sharp({ create: { width: size, height: size, channels: 4, background } }).composite([
    { input: mark, gravity: "centre" },
  ]);
  if (radius !== undefined) {
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
        `<rect width="${size}" height="${size}" rx="${Math.round(size * radius)}" fill="#fff"/></svg>`,
    );
    image = sharp(await image.png().toBuffer()).composite([{ input: mask, blend: "dest-in" }]);
  }
  return image;
}

/** An .ico holding one PNG, which every current browser reads. */
function ico(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header[6] = size; // width
  header[7] = size; // height
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // offset of the image data
  return Buffer.concat([header, png]);
}

const g = await readGlyph();
await mkdir(BRAND, { recursive: true });
await mkdir(PUBLIC, { recursive: true });

const out = [];
const save = async (path, buffer) => {
  await writeFile(path, buffer);
  out.push([path.slice(ROOT.length + 1).replaceAll("\\", "/"), buffer.length]);
};

// The README's pair: a dark glyph for light pages and a light one for dark.
await save(join(BRAND, "logo-black.webp"), await (await tile(g, { size: 512, rgb: BLACK, pad: 0.04 })).webp({ lossless: true }).toBuffer());
await save(join(BRAND, "logo-white.webp"), await (await tile(g, { size: 512, rgb: WHITE, pad: 0.04 })).webp({ lossless: true }).toBuffer());

// The dashboard's mark. One black file: the dark theme inverts it, so there is no second image to keep in step.
await save(join(PUBLIC, "logo.webp"), await (await tile(g, { size: 256, rgb: BLACK, pad: 0.02 })).webp({ lossless: true }).toBuffer());

// Tab icons: the glyph alone, in whichever colour shows on the browser's own chrome.
await save(join(PUBLIC, "icon-on-light.png"), await (await tile(g, { size: 64, rgb: BLACK, pad: 0.06 })).png({ compressionLevel: 9 }).toBuffer());
await save(join(PUBLIC, "icon-on-dark.png"), await (await tile(g, { size: 64, rgb: WHITE, pad: 0.06 })).png({ compressionLevel: 9 }).toBuffer());

// iOS rounds the corners itself and does not do transparency, so: a flat white square.
await save(join(PUBLIC, "apple-icon.png"), await (await tile(g, { size: 180, rgb: BLACK, pad: 0.2, ground: WHITE })).png({ compressionLevel: 9 }).toBuffer());

// The fallback every crawler asks for, a tile that is legible on any ground.
const favicon = await (await tile(g, { size: 32, rgb: BLACK, pad: 0.14, ground: WHITE, radius: 0.22 })).png({ compressionLevel: 9 }).toBuffer();
await save(join(PUBLIC, "favicon.ico"), ico(favicon, 32));

// The card a link unfurls into. No text: the renderer has no guarantee of a font, and a wrong one is worse than none.
const card = sharp({ create: { width: 1200, height: 630, channels: 4, background: { r: NIGHT[0], g: NIGHT[1], b: NIGHT[2], alpha: 1 } } })
  .composite([{ input: await glyph(g, WHITE, 300), gravity: "centre" }])
  .png({ compressionLevel: 9 });
await save(join(PUBLIC, "og.png"), await card.toBuffer());

for (const [path, bytes] of out) console.log(`${path.padEnd(34)} ${String(bytes).padStart(7)} bytes`);

/*
 * A record of which source these were made from.
 *
 * Without it, replacing `brand/lockstep-logo.webp` and forgetting to run this leaves the dashboard, the
 * favicons and the README on the old logo with nothing to say so. `app/test/logo.test.ts` compares the hash
 * below with the file on disk, so CI fails until the derived files are rebuilt.
 */
const sourceBytes = await readFile(SOURCE);
const record = {
  source: "brand/lockstep-logo.webp",
  sha256: createHash("sha256").update(sourceBytes).digest("hex"),
  derived: out.map(([path]) => path).sort(),
};
await writeFile(join(BRAND, "assets.json"), `${JSON.stringify(record, null, 2)}\n`);
console.log(`brand/assets.json                  source sha256 ${record.sha256.slice(0, 12)}...`);
