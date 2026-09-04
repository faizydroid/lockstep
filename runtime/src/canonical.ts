/**
 * Canonical skill hashing.
 *
 * A Lockstep pin is only meaningful if every party independently derives the same
 * hash for the same skill. That is harder than `keccak256(bytes)` because a skill is
 * a directory tree that travels through git, npm, and three operating systems before
 * it is loaded.
 *
 * Two failure modes drive every decision here:
 *
 *   FALSE POSITIVE - the same logical skill hashes differently on two machines.
 *     The user sees their agent blocked for no reason and turns Lockstep off.
 *     This is the product-killing failure.
 *
 *   FALSE NEGATIVE - different effective content hashes identically.
 *     An attacker mutates behaviour without invalidating the pin.
 *     This is the security-killing failure.
 *
 * The policy below is the narrowest set of normalisations that removes known
 * false-positive sources without opening a false-negative path.
 */

import { keccak_256 } from "@noble/hashes/sha3";

/**
 * Identifies the hashing policy, and is committed to inside every hash preimage.
 *
 * Because the scheme id is part of what gets hashed, a future policy change
 * produces provably different hashes rather than silently reinterpreting old
 * pins. Old pins stay verifiable under the scheme they were created with.
 */
export const SCHEME_ID = "lockstep-skill-hash/v2" as const;

/** Domain separators. Distinct bytes so a leaf hash can never be read as a root hash. */
const DOMAIN_LEAF = 0x00;
const DOMAIN_ROOT = 0x01;

/**
 * Extensions whose line endings are normalised CRLF/CR -> LF before hashing.
 *
 * Rationale: git's `core.autocrlf` rewrites line endings on checkout, so the same
 * commit yields different bytes on Windows and Linux. Without normalisation every
 * cross-platform install is a false positive.
 *
 * Safety: line-ending style carries no executable or injectable payload in any of
 * these formats, so collapsing it cannot hide a behavioural change. This is an
 * explicit allowlist rather than a text/binary heuristic, because heuristics are
 * attack surface: an attacker who can steer a file into the "text" branch could
 * use normalisation to mask a difference.
 */
const NORMALISED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".jsx",
  ".tsx",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".py",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".graphql",
  ".css",
  ".html",
  ".xml",
  ".csv",
  ".env",
  ".ini",
  ".cfg",
  ".sol",
]);

/**
 * Paths excluded from the hash. Deliberately minimal.
 *
 * `.git` is the only safe exclusion: it is metadata the agent runtime never loads,
 * and it contains per-clone state that would otherwise make every checkout hash
 * differently.
 *
 * Note what is NOT excluded. `node_modules` is hashed. Excluding it would let an
 * attacker swap a transitive dependency without changing the skill hash, which is
 * precisely the supply-chain attack Lockstep exists to stop. Publishers must
 * therefore either vendor dependencies or ship a lockfile inside the skill
 * directory. That is a real cost and it is the correct trade.
 */
const EXCLUDED_TOP_LEVEL: ReadonlySet<string> = new Set([".git"]);

export interface SkillFile {
  /** Path relative to the skill root. POSIX separators. */
  readonly path: string;
  /** Raw file bytes, exactly as they will be loaded. */
  readonly content: Uint8Array;
  /**
   * Whether the file is executable.
   *
   * Committed to by the hash because `chmod +x` on a helper script changes what
   * runs without changing a single content byte. A skill invoking `./run.sh`
   * behaves differently from one that cannot. OpenClaw's own skill revision hash
   * includes executable flags for the same reason.
   *
   * Cross-platform caveat: Windows filesystems cannot represent this bit, so a
   * skill pinned on Windows and pinned on Linux can disagree when any file is
   * executable. Publishers must pin from CI on Linux, which the GitHub Action
   * enforces by being the only sanctioned publishing path. Defaults to false.
   */
  readonly executable?: boolean;
}

export interface SkillHashEntry {
  readonly path: string;
  /** keccak256 of the leaf preimage for this file. */
  readonly contentHash: Uint8Array;
  /** Byte length after normalisation. Diagnostics only; not hashed directly. */
  readonly normalisedLength: number;
  readonly normalised: boolean;
  readonly executable: boolean;
}

export interface SkillHashResult {
  /** 0x-prefixed keccak256 root. This is the value that gets pinned on-chain. */
  readonly skillHash: `0x${string}`;
  readonly scheme: typeof SCHEME_ID;
  /** Per-file breakdown, sorted canonically. Powers human-readable diffs. */
  readonly entries: readonly SkillHashEntry[];
}

export type SkillHashErrorCode =
  | "EMPTY_SKILL"
  | "DUPLICATE_PATH"
  | "INVALID_PATH"
  | "SYMLINK_REJECTED";

export class SkillHashError extends Error {
  // Declared and assigned explicitly rather than as a constructor parameter property.
  // Parameter properties emit assignment code, so Node's type stripping refuses the whole
  // file, and this package has no build step standing between source and runtime.
  readonly code: SkillHashErrorCode;

  constructor(message: string, code: SkillHashErrorCode) {
    super(message);
    this.code = code;
    this.name = "SkillHashError";
  }
}

const textEncoder = new TextEncoder();

function extensionOf(path: string): string {
  const slash = path.lastIndexOf("/");
  const base = slash === -1 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  // A leading dot means a dotfile with no extension (".env" is handled by name below).
  if (dot <= 0) {
    return base.startsWith(".") ? base.toLowerCase() : "";
  }
  return base.slice(dot).toLowerCase();
}

function shouldNormalise(path: string): boolean {
  return NORMALISED_EXTENSIONS.has(extensionOf(path));
}

/**
 * Strips a UTF-8 BOM and collapses CRLF and lone CR to LF.
 *
 * Editors on Windows add both; neither changes meaning in the allowlisted formats.
 * Operates on bytes rather than decoded strings so invalid UTF-8 passes through
 * untouched instead of being replaced with U+FFFD, which would be lossy and would
 * let two different byte sequences collide.
 */
export function normaliseTextBytes(input: Uint8Array): Uint8Array {
  let start = 0;
  if (
    input.length >= 3 &&
    input[0] === 0xef &&
    input[1] === 0xbb &&
    input[2] === 0xbf
  ) {
    start = 3;
  }

  const out = new Uint8Array(input.length - start);
  let written = 0;
  for (let i = start; i < input.length; i += 1) {
    const byte = input[i]!;
    if (byte === 0x0d) {
      // CR: emit a single LF, and swallow a following LF so CRLF collapses to one.
      out[written] = 0x0a;
      written += 1;
      if (input[i + 1] === 0x0a) i += 1;
      continue;
    }
    out[written] = byte;
    written += 1;
  }
  return out.subarray(0, written);
}

/**
 * Canonicalises a relative path.
 *
 * - Backslashes become forward slashes, so a Windows publisher and a Linux
 *   consumer agree.
 * - Unicode is NFC-normalised, because macOS stores filenames as NFD and would
 *   otherwise produce a different hash for a visually identical name.
 * - Traversal and absolute paths are rejected outright: a skill must not be able
 *   to claim a file outside its own root.
 */
export function canonicalisePath(rawPath: string): string {
  const unified = rawPath.replace(/\\/g, "/").normalize("NFC");
  const trimmed = unified.replace(/^\.\//, "");

  if (trimmed.length === 0) {
    throw new SkillHashError("Empty path", "INVALID_PATH");
  }
  if (trimmed.startsWith("/") || /^[a-zA-Z]:/.test(trimmed)) {
    throw new SkillHashError(
      `Absolute path not allowed: ${rawPath}`,
      "INVALID_PATH",
    );
  }
  const segments = trimmed.split("/");
  if (segments.some((s) => s === ".." || s === "." || s === "")) {
    throw new SkillHashError(
      `Path must be normalised and contain no traversal: ${rawPath}`,
      "INVALID_PATH",
    );
  }
  return trimmed;
}

export function isExcluded(canonicalPath: string): boolean {
  const [top] = canonicalPath.split("/");
  return top !== undefined && EXCLUDED_TOP_LEVEL.has(top);
}

/**
 * Byte-wise comparison of UTF-8 encoded paths.
 *
 * Deliberately not `localeCompare`, and deliberately not JS string comparison:
 * both vary with locale or surrogate handling. Byte order is the only ordering
 * every implementation in every language will agree on, which matters because a
 * Python or Go implementation of this scheme must produce identical hashes.
 */
export function comparePathBytes(a: string, b: string): number {
  const ab = textEncoder.encode(a);
  const bb = textEncoder.encode(b);
  const shared = Math.min(ab.length, bb.length);
  for (let i = 0; i < shared; i += 1) {
    const diff = ab[i]! - bb[i]!;
    if (diff !== 0) return diff;
  }
  return ab.length - bb.length;
}

function u32be(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = (value >>> 24) & 0xff;
  buf[1] = (value >>> 16) & 0xff;
  buf[2] = (value >>> 8) & 0xff;
  buf[3] = value & 0xff;
  return buf;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function toHex(bytes: Uint8Array): `0x${string}` {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `0x${hex}`;
}

/**
 * Leaf hash for one file.
 *
 * Preimage:
 *   DOMAIN_LEAF || u32be(pathByteLength) || pathBytes || u8(executable) || contentBytes
 *
 * The path length prefix is load bearing. Without it, ("ab", "c") and ("a", "bc")
 * would produce the same preimage, so an attacker could move bytes between a
 * filename and a file body while preserving the hash.
 *
 * The executable byte sits between path and content so it can never be confused
 * with either: content cannot absorb it because the path length is already fixed,
 * and the path cannot absorb it because it comes after the declared length.
 */
export function hashLeaf(
  canonicalPath: string,
  content: Uint8Array,
  executable = false,
): Uint8Array {
  const pathBytes = textEncoder.encode(canonicalPath);
  return keccak_256(
    concat([
      new Uint8Array([DOMAIN_LEAF]),
      u32be(pathBytes.length),
      pathBytes,
      new Uint8Array([executable ? 1 : 0]),
      content,
    ]),
  );
}

/**
 * Computes the canonical hash of a skill.
 *
 * Root preimage:
 *   DOMAIN_ROOT || u32be(schemeLen) || schemeBytes || u32be(fileCount)
 *     || for each file, ordered by path bytes: u32be(pathLen) || pathBytes || leafHash
 *
 * The file count is committed to so that a truncated entry list cannot be passed
 * off as a complete one, and each path is length-prefixed for the same reason as
 * in the leaf.
 */
export function hashSkill(files: readonly SkillFile[]): SkillHashResult {
  const seen = new Map<string, SkillHashEntry>();

  for (const file of files) {
    const path = canonicalisePath(file.path);
    if (isExcluded(path)) continue;

    if (seen.has(path)) {
      throw new SkillHashError(
        `Duplicate path after canonicalisation: ${path}`,
        "DUPLICATE_PATH",
      );
    }

    const normalised = shouldNormalise(path);
    const content = normalised
      ? normaliseTextBytes(file.content)
      : file.content;
    const executable = file.executable === true;

    seen.set(path, {
      path,
      contentHash: hashLeaf(path, content, executable),
      normalisedLength: content.length,
      normalised,
      executable,
    });
  }

  if (seen.size === 0) {
    throw new SkillHashError(
      "Skill contains no hashable files",
      "EMPTY_SKILL",
    );
  }

  const entries = [...seen.values()].sort((a, b) =>
    comparePathBytes(a.path, b.path),
  );

  const schemeBytes = textEncoder.encode(SCHEME_ID);
  const parts: Uint8Array[] = [
    new Uint8Array([DOMAIN_ROOT]),
    u32be(schemeBytes.length),
    schemeBytes,
    u32be(entries.length),
  ];
  for (const entry of entries) {
    const pathBytes = textEncoder.encode(entry.path);
    parts.push(u32be(pathBytes.length), pathBytes, entry.contentHash);
  }

  return {
    skillHash: toHex(keccak_256(concat(parts))),
    scheme: SCHEME_ID,
    entries,
  };
}
