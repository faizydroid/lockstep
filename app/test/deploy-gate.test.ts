/**
 * The production deploy gate in .github/workflows/deploy-dashboard.yml.
 *
 * That job holds CLOUDFLARE_API_TOKEN, builds whatever commit it checks out, and publishes to
 * production, so the single `if:` in front of it decides who can ship code to the dashboard. The
 * first version of it tested a green CI conclusion and `head_branch == 'main'`. A fork pull request
 * satisfies both: `workflow_run` jobs get secrets even when an unprivileged `pull_request` run
 * triggered them, `head_branch` is the pull request's own branch name, and the pull request supplies
 * its own ci.yml, so it can make CI pass. A fork whose branch is called `main` therefore reached the
 * job, which then checked out the fork's commit and ran its `npm ci` and build with the token in
 * scope for a later step.
 *
 * These tests evaluate the real expression from the real file against the payload shapes GitHub sends,
 * so loosening it again fails here. Nothing is sent to GitHub.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (name: string) => readFileSync(join(ROOT, ".github", "workflows", name), "utf8").replace(/\r\n/g, "\n");

/** The folded `if: >-` scalar on the deploy job, joined back into one expression. */
function jobCondition(yml: string): string {
  const lines = yml.split("\n");
  const start = lines.findIndex((line) => /^ {4}if: >-\s*$/.test(line));
  if (start === -1) throw new Error("the deploy job has no folded `if:` condition");
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^ {6,}\S/.test(line)) break;
    body.push(line.trim());
  }
  return body.join(" ");
}

/**
 * GitHub expression to JS, for the subset this condition uses: `==`, `&&`, `||`, parentheses, string
 * literals and dotted property reads. Anything else makes `new Function` throw, which fails the test
 * loudly instead of quietly evaluating something different from what GitHub would.
 *
 * Property reads become optional chains because GitHub's expression language yields null for a
 * missing property instead of throwing: a `workflow_dispatch` payload has no `workflow_run` at all.
 */
function evaluate(expression: string, github: unknown): boolean {
  const js = expression
    .split(/('[^']*')/)
    .map((part) =>
      part.startsWith("'")
        ? JSON.stringify(part.slice(1, -1))
        : part.replace(/==/g, "===").replace(/(?<=[\w)])\.(?=[A-Za-z_])/g, "?."),
    )
    .join("");
  // eslint-disable-next-line no-new-func
  return Boolean(new Function("github", `return (${js});`)(github));
}

const REPO = "faizydroid/lockstep";

interface Payload {
  readonly event_name: string;
  readonly ref: string;
  readonly repository: string;
  readonly event: { readonly workflow_run?: Record<string, unknown> };
}

/** A `workflow_run` delivery for a completed CI run. */
function ciCompleted(run: Record<string, unknown>): Payload {
  return {
    event_name: "workflow_run",
    // For workflow_run the ref is always the default branch of the base repository.
    ref: "refs/heads/main",
    repository: REPO,
    event: {
      workflow_run: {
        conclusion: "success",
        event: "push",
        head_branch: "main",
        head_sha: "11d5960a326750d5838078e36cf38b85af677262",
        head_repository: { full_name: REPO },
        ...run,
      },
    },
  };
}

function dispatch(ref: string): Payload {
  return { event_name: "workflow_dispatch", ref, repository: REPO, event: {} };
}

describe("deploy-dashboard.yml gate", () => {
  const condition = jobCondition(read("deploy-dashboard.yml"));

  it("is able to fail: the previous condition admitted the fork, so the cases below discriminate", () => {
    // The gate as it was before this file existed, kept verbatim. If this stops being true the
    // evaluator is no longer modelling what GitHub does, and every assertion below proves nothing.
    const previous =
      "github.event_name == 'workflow_dispatch' || " +
      "(github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_branch == 'main')";
    const fork = ciCompleted({
      event: "pull_request",
      head_branch: "main",
      head_repository: { full_name: "attacker/lockstep" },
    });
    expect(evaluate(previous, fork)).toBe(true);
    expect(evaluate(condition, fork)).toBe(false);
  });

  it("admits a green CI run of a push to main in this repository", () => {
    expect(evaluate(condition, ciCompleted({}))).toBe(true);
  });

  it("admits a manual run from main", () => {
    expect(evaluate(condition, dispatch("refs/heads/main"))).toBe(true);
  });

  it("refuses a fork pull request whose branch is named main (the pwn request)", () => {
    const fork = ciCompleted({
      event: "pull_request",
      head_branch: "main",
      head_sha: "0000000000000000000000000000000000000bad",
      head_repository: { full_name: "attacker/lockstep" },
    });
    expect(evaluate(condition, fork)).toBe(false);
  });

  it("refuses any pull request run, including one from this repository", () => {
    expect(evaluate(condition, ciCompleted({ event: "pull_request", head_branch: "fix/something" }))).toBe(false);
    expect(evaluate(condition, ciCompleted({ event: "pull_request", head_branch: "main" }))).toBe(false);
  });

  it("refuses a head repository that is not this one, whatever the event says", () => {
    expect(evaluate(condition, ciCompleted({ head_repository: { full_name: "attacker/lockstep" } }))).toBe(false);
  });

  it("refuses a failed run and a push to another branch", () => {
    expect(evaluate(condition, ciCompleted({ conclusion: "failure" }))).toBe(false);
    expect(evaluate(condition, ciCompleted({ conclusion: "cancelled" }))).toBe(false);
    expect(evaluate(condition, ciCompleted({ head_branch: "feature" }))).toBe(false);
  });

  it("refuses a manual run from any other ref", () => {
    expect(evaluate(condition, dispatch("refs/heads/feature"))).toBe(false);
    expect(evaluate(condition, dispatch("refs/tags/v0.1.2"))).toBe(false);
  });
});

describe("third-party actions in the workflows that hold secrets", () => {
  // deploy-dashboard.yml receives the Cloudflare token and pin-skill.yml the publisher key. A tag can
  // be moved after the fact, so what is trusted is a commit.
  for (const file of ["deploy-dashboard.yml", "pin-skill.yml"]) {
    it(`${file} pins every external action to a full commit SHA`, () => {
      const uses = [...read(file).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]!);
      const external = uses.filter((u) => !u.startsWith("./"));
      expect(external.length).toBeGreaterThan(0);
      for (const ref of external) {
        expect(ref, `${file}: ${ref}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      }
    });
  }
});
