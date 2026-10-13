/**
 * Maps a URL path to a file inside a static export, or null.
 *
 * Shared by `serve-export.mjs` and its tests. Returns null rather than throwing for anything it will
 * not serve: a path that leaves the export, a path that does not exist, and a path that is not valid
 * percent-encoding. That last one used to throw. `GET /%` made `decodeURIComponent` raise a
 * `URIError` inside the request handler, nothing caught it, and the whole server process exited, so
 * one malformed request from the network (or a browser extension, or a crawler) ended the preview.
 *
 * The containment check is done on the *resolved* path with a trailing separator, because a prefix
 * comparison without one lets `app/outside/` pass as being inside `app/out`.
 */

import { existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export function fileFor(out, urlPath) {
  const root = resolve(out);

  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  // A NUL byte is never a legitimate path character, and some filesystems stop reading at one.
  if (decoded.includes("\0")) return null;

  const candidate = resolve(root, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;

  // `output: export` writes `/pins` as `pins.html`, so a bare route needs the extension added.
  // Directory-style `/pins/` gets `index.html`, which is what a static host would do.
  for (const attempt of [candidate, `${candidate}.html`, join(candidate, "index.html")]) {
    try {
      if (existsSync(attempt) && statSync(attempt).isFile()) return attempt;
    } catch {
      // A path the filesystem rejects (reserved names, over-long components) is simply not a file.
    }
  }
  return null;
}
