/**
 * Serves the dashboard's static export on localhost.
 *
 * `next start` cannot do this. `app/next.config.ts` sets `output: "export"`, so there is no Node
 * server to start -- the build emits files, and `next start` refuses with a message telling you to
 * use a static host. This is that static host, and using it means what you look at locally is byte
 * for byte the artifact CI checks with `scripts/check-export.mjs` and the artifact that would be
 * deployed. `next dev` would show you a differently-built application.
 *
 *   node scripts/serve-export.mjs            # http://127.0.0.1:4173
 *   node scripts/serve-export.mjs --port 8080
 *
 * ## Scope, stated because it is a server
 *
 * Binds to 127.0.0.1 only, so it is not reachable from the network, and there is no authentication
 * because there is nothing to authenticate: every byte it serves is already public, the pages are
 * read-only views over public chain state, and the client bundle deliberately cannot encode a
 * transaction that asserts anything (see app/src/lib/policy.ts). Pass `--host 0.0.0.0` to expose it
 * on the LAN, which is fine for showing someone the demo and is opt-in rather than the default.
 *
 * It also serves GET and HEAD and nothing else, and refuses any path that escapes the export
 * directory after resolution -- a static server that resolves `..` is a file-read primitive.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "app", "out");

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 || process.argv[at + 1] === undefined ? fallback : process.argv[at + 1];
}

const PORT = Number(arg("port", "4173"));
const HOST = arg("host", "127.0.0.1");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

/**
 * Security headers, set here because this is the one place in the project that is a server.
 *
 * The deployed dashboard is static files behind whatever host serves them, so it gets a `<meta>` CSP
 * in `app/layout.tsx` instead. Three of the protections below **cannot** be expressed in a meta tag —
 * `frame-ancestors`, `X-Frame-Options` and `Referrer-Policy` are header-only — which is worth stating
 * rather than leaving a reader to assume the meta version is equivalent. It is not: a static deploy
 * needs these configured at the host.
 *
 * The CSP is honest about its own weakness. `script-src` needs `'unsafe-inline'` because Next inlines
 * its bootstrap and this app inlines a pre-paint theme script, and a static export cannot use nonces —
 * a nonce has to be minted per response and there are no responses to mint it in. So this is not
 * XSS-proof and does not claim to be. What it does buy is real: `object-src 'none'` kills plugin
 * embeds, `base-uri 'none'` blocks base-tag injection (which would silently repoint every relative
 * URL on the page), `form-action 'none'` matters because there are no forms so any that appear are
 * not ours, and `frame-ancestors 'none'` stops the dashboard being framed by a page that wants a
 * reader to think they are approving something.
 *
 * `connect-src` allows `https:` broadly rather than pinning the RPC host, because settings let a
 * reader supply their own endpoint. Pinning it would break that on purpose; the compensating control
 * is that an override is disclosed in the source bar on every page.
 */
const SECURITY_HEADERS = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; "),
  // Stops a browser guessing that a .txt is HTML, which is how a text file becomes a script.
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  // No URL leaves this origin in a Referer. Pin ids and account addresses live in these URLs.
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  // No reason for a read-only dashboard to be able to ask for any of these.
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

/**
 * Maps a URL path to a file inside the export, or null.
 *
 * Returns null rather than throwing for anything outside `OUT`. The containment check is done on
 * the *resolved* path with a trailing separator, because a prefix comparison without one lets
 * `app/outside/` pass as being inside `app/out`.
 */
function fileFor(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const candidate = resolve(OUT, `.${decoded.startsWith("/") ? decoded : `/${decoded}`}`);

  if (candidate !== OUT && !candidate.startsWith(OUT + sep)) return null;

  // `output: export` writes `/pins` as `pins.html`, so a bare route needs the extension added.
  // Directory-style `/pins/` gets `index.html`, which is what a static host would do.
  for (const attempt of [
    candidate,
    `${candidate}.html`,
    join(candidate, "index.html"),
  ]) {
    if (existsSync(attempt) && statSync(attempt).isFile()) return attempt;
  }
  return null;
}

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }

  const file = fileFor(req.url ?? "/") ?? fileFor("/index.html");
  const notFound = fileFor(req.url ?? "/") === null;

  if (file === null) {
    res.writeHead(500, { "content-type": "text/plain" }).end(
      `No export at ${OUT}\nRun: npm run build --workspace @lockstep/app\n`,
    );
    return;
  }

  const status = notFound ? 404 : 200;
  const body = notFound ? (fileFor("/404.html") ?? file) : file;

  res.writeHead(status, {
    "content-type": TYPES[extname(body)] ?? "application/octet-stream",
    "content-length": statSync(body).size,
    // No caching. This is a local preview of a build that gets rebuilt, and a cached chunk from a
    // previous build is a confusing way to spend twenty minutes.
    "cache-control": "no-store",
    ...SECURITY_HEADERS,
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(body).pipe(res);
});

if (!existsSync(OUT)) {
  process.stderr.write(
    `no export at ${OUT}\nRun: npm run build --workspace @lockstep/app\n`,
  );
  process.exit(1);
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    process.stderr.write(`port ${PORT} is already in use. Try --port ${PORT + 1}\n`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`serving ${OUT}\n`);
  process.stdout.write(`  http://${HOST}:${PORT}\n\n`);
  process.stdout.write("routes\n");
  for (const route of ["", "pins", "drift", "approvals", "publishers", "bonds", "badge"]) {
    process.stdout.write(`  http://${HOST}:${PORT}/${route}\n`);
  }
  if (HOST !== "127.0.0.1" && HOST !== "localhost") {
    process.stdout.write(`\nreachable from the network on ${HOST}. There is no auth; every byte here is public.\n`);
  }
});
