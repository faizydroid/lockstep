import { describe, expect, it } from "vitest";

import {
  SCHEME_ID,
  SkillHashError,
  canonicalisePath,
  comparePathBytes,
  hashSkill,
  normaliseTextBytes,
  type SkillFile,
} from "../src/canonical.ts";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

const file = (path: string, content: string | Uint8Array): SkillFile => ({
  path,
  content: typeof content === "string" ? utf8(content) : content,
});

const SKILL_MD = "# Trade\n\nQuote and swap on Kuru.\n";

describe("determinism", () => {
  it("is independent of input order", () => {
    const a = hashSkill([
      file("skill.md", SKILL_MD),
      file("scripts/quote.js", "export const q = 1;\n"),
      file("assets/logo.svg", "<svg/>\n"),
    ]);
    const b = hashSkill([
      file("assets/logo.svg", "<svg/>\n"),
      file("skill.md", SKILL_MD),
      file("scripts/quote.js", "export const q = 1;\n"),
    ]);

    expect(a.skillHash).toBe(b.skillHash);
  });

  it("emits entries sorted by path bytes", () => {
    const result = hashSkill([
      file("b.md", "b"),
      file("a/z.md", "z"),
      file("a/a.md", "a"),
    ]);

    expect(result.entries.map((e) => e.path)).toEqual([
      "a/a.md",
      "a/z.md",
      "b.md",
    ]);
  });

  it("commits to the scheme id", () => {
    expect(hashSkill([file("skill.md", SKILL_MD)]).scheme).toBe(SCHEME_ID);
  });
});

/**
 * The product-killing failure. If a Windows publisher and a Linux consumer
 * disagree, users see false blocks and disable Lockstep.
 */
describe("false positives: cross-platform equivalence", () => {
  it("treats CRLF and LF as identical in normalised formats", () => {
    const crlf = hashSkill([file("skill.md", "# Trade\r\n\r\nSwap.\r\n")]);
    const lf = hashSkill([file("skill.md", "# Trade\n\nSwap.\n")]);

    expect(crlf.skillHash).toBe(lf.skillHash);
  });

  it("treats a lone CR as a line ending too", () => {
    const cr = hashSkill([file("scripts/a.js", "let a = 1;\rlet b = 2;\r")]);
    const lf = hashSkill([file("scripts/a.js", "let a = 1;\nlet b = 2;\n")]);

    expect(cr.skillHash).toBe(lf.skillHash);
  });

  it("ignores a UTF-8 BOM", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(SKILL_MD)]);

    expect(hashSkill([file("skill.md", withBom)]).skillHash).toBe(
      hashSkill([file("skill.md", SKILL_MD)]).skillHash,
    );
  });

  it("accepts Windows path separators", () => {
    expect(hashSkill([file("scripts\\quote.js", "x")]).skillHash).toBe(
      hashSkill([file("scripts/quote.js", "x")]).skillHash,
    );
  });

  it("normalises Unicode filenames to NFC", () => {
    // macOS stores filenames decomposed; Linux typically composed.
    const nfd = "cafe\u0301/skill.md";
    const nfc = "caf\u00e9/skill.md";

    expect(hashSkill([file(nfd, SKILL_MD)]).skillHash).toBe(
      hashSkill([file(nfc, SKILL_MD)]).skillHash,
    );
  });
});

/**
 * The security-killing failure. Anything that changes what executes must change
 * the hash.
 */
describe("false negatives: behavioural changes must alter the hash", () => {
  it("does not normalise line endings in non-allowlisted formats", () => {
    const crlf = hashSkill([file("data.bin", "a\r\nb")]);
    const lf = hashSkill([file("data.bin", "a\nb")]);

    expect(crlf.skillHash).not.toBe(lf.skillHash);
  });

  it("detects a single changed byte in the instructions", () => {
    const honest = hashSkill([file("skill.md", "Send to the user.\n")]);
    const hostile = hashSkill([file("skill.md", "Send to the attacker.\n")]);

    expect(honest.skillHash).not.toBe(hostile.skillHash);
  });

  it("detects a rename with identical content", () => {
    const before = hashSkill([file("scripts/quote.js", "x")]);
    const after = hashSkill([file("scripts/swap.js", "x")]);

    expect(before.skillHash).not.toBe(after.skillHash);
  });

  it("detects an added file", () => {
    const before = hashSkill([file("skill.md", SKILL_MD)]);
    const after = hashSkill([
      file("skill.md", SKILL_MD),
      file("scripts/exfil.js", "fetch(evil)\n"),
    ]);

    expect(before.skillHash).not.toBe(after.skillHash);
  });

  it("detects a removed file", () => {
    const before = hashSkill([
      file("skill.md", SKILL_MD),
      file("scripts/quote.js", "x"),
    ]);
    const after = hashSkill([file("skill.md", SKILL_MD)]);

    expect(before.skillHash).not.toBe(after.skillHash);
  });

  /**
   * Without a length prefix on the path, ("ab", "c") and ("a", "bc") share a
   * preimage, letting an attacker shift bytes between filename and body while
   * holding the hash constant.
   */
  it("resists path/content boundary ambiguity", () => {
    const left = hashSkill([file("ab", "c")]);
    const right = hashSkill([file("a", "bc")]);

    expect(left.skillHash).not.toBe(right.skillHash);
  });

  it("resists file-count truncation via path concatenation", () => {
    const two = hashSkill([file("a", "1"), file("b", "2")]);
    const one = hashSkill([file("ab", "12")]);

    expect(two.skillHash).not.toBe(one.skillHash);
  });

  /**
   * `chmod +x` changes what runs without changing a byte of content. A skill
   * that can invoke `./run.sh` behaves differently from one that cannot.
   */
  it("detects a file becoming executable", () => {
    const notExec = hashSkill([
      { path: "scripts/run.sh", content: utf8("#!/bin/sh\necho hi\n"), executable: false },
    ]);
    const exec = hashSkill([
      { path: "scripts/run.sh", content: utf8("#!/bin/sh\necho hi\n"), executable: true },
    ]);

    expect(exec.skillHash).not.toBe(notExec.skillHash);
  });

  it("treats an absent executable flag as not executable", () => {
    const implicit = hashSkill([file("scripts/run.sh", "x")]);
    const explicit = hashSkill([
      { path: "scripts/run.sh", content: utf8("x"), executable: false },
    ]);

    expect(implicit.skillHash).toBe(explicit.skillHash);
  });

  /**
   * The executable byte must not be absorbable into either neighbour. Content
   * starting with 0x01 must not collide with an executable file whose content
   * is one byte shorter.
   */
  it("keeps the executable byte distinct from content", () => {
    const execEmpty = hashSkill([
      { path: "a", content: new Uint8Array([]), executable: true },
    ]);
    const notExecOne = hashSkill([
      { path: "a", content: new Uint8Array([0x01]), executable: false },
    ]);

    expect(execEmpty.skillHash).not.toBe(notExecOne.skillHash);
  });

  /**
   * node_modules is intentionally hashed. Excluding it would let an attacker
   * swap a transitive dependency without invalidating the pin, which is the
   * exact supply-chain attack this project exists to block.
   */
  it("includes node_modules in the hash", () => {
    const clean = hashSkill([file("skill.md", SKILL_MD)]);
    const tampered = hashSkill([
      file("skill.md", SKILL_MD),
      file("node_modules/left-pad/index.js", "steal()\n"),
    ]);

    expect(tampered.skillHash).not.toBe(clean.skillHash);
    expect(tampered.entries.map((e) => e.path)).toContain(
      "node_modules/left-pad/index.js",
    );
  });
});

describe("exclusions", () => {
  it("excludes .git and is unaffected by its contents", () => {
    const withGit = hashSkill([
      file("skill.md", SKILL_MD),
      file(".git/HEAD", "ref: refs/heads/main\n"),
      file(".git/objects/ab/cdef", "blob"),
    ]);
    const withoutGit = hashSkill([file("skill.md", SKILL_MD)]);

    expect(withGit.skillHash).toBe(withoutGit.skillHash);
    expect(withGit.entries).toHaveLength(1);
  });

  it("does not exclude a file merely named .gitignore", () => {
    const result = hashSkill([
      file("skill.md", SKILL_MD),
      file(".gitignore", "node_modules\n"),
    ]);

    expect(result.entries.map((e) => e.path)).toContain(".gitignore");
  });
});

describe("path validation", () => {
  it.each([
    ["../escape.md", "traversal"],
    ["a/../../escape.md", "nested traversal"],
    ["/etc/passwd", "absolute posix"],
    ["C:/Windows/System32/x.dll", "absolute windows"],
    ["a//b.md", "empty segment"],
    ["./a/./b.md", "interior dot segment"],
  ])("rejects %s (%s)", (path) => {
    expect(() => canonicalisePath(path)).toThrow(SkillHashError);
  });

  it("strips a single leading ./", () => {
    expect(canonicalisePath("./skill.md")).toBe("skill.md");
  });

  it("rejects duplicate paths that collide after canonicalisation", () => {
    expect(() =>
      hashSkill([file("scripts/a.js", "1"), file("scripts\\a.js", "2")]),
    ).toThrow(SkillHashError);
  });

  it("rejects a skill with no hashable files", () => {
    expect(() => hashSkill([file(".git/HEAD", "ref")])).toThrow(SkillHashError);
  });
});

describe("byte-order path comparison", () => {
  it("orders by UTF-8 bytes, not locale", () => {
    expect(comparePathBytes("a", "b")).toBeLessThan(0);
    expect(comparePathBytes("Z", "a")).toBeLessThan(0); // uppercase sorts first
    expect(comparePathBytes("a", "a")).toBe(0);
  });

  it("treats a prefix as ordered before its extension", () => {
    expect(comparePathBytes("a", "ab")).toBeLessThan(0);
  });
});

describe("normaliseTextBytes", () => {
  it("collapses CRLF to LF", () => {
    expect([...normaliseTextBytes(utf8("a\r\nb"))]).toEqual([...utf8("a\nb")]);
  });

  it("leaves invalid UTF-8 untouched rather than replacing it", () => {
    const invalid = new Uint8Array([0x61, 0xff, 0xfe, 0x62]);

    expect([...normaliseTextBytes(invalid)]).toEqual([...invalid]);
  });

  it("is a no-op on already-normalised input", () => {
    const input = utf8("a\nb\nc\n");

    expect([...normaliseTextBytes(input)]).toEqual([...input]);
  });
});
