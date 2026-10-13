/**
 * What the CLI and the Action print when something goes wrong, and what goes into a Markdown summary.
 *
 * An audit found three ways text from outside ended up somewhere that gives it meaning:
 *
 *   - an RPC error printed with its URL, and RPC URLs often carry an API key in the path;
 *   - an error message with a newline in it, printed as a workflow command, so the second line was
 *     parsed by the runner as a command of its own;
 *   - a selector label in a manifest interpolated into the job summary, where one string was enough to
 *     open an HTML comment around the two real high-risk rows of a capability table.
 *
 * Each case fails against the behaviour it replaced.
 */
import { describe, expect, it } from "vitest";

import { escapeCommandData, escapeMarkdown, inlineCode, redactUrls, safeErrorMessage, workflowErrorCommand } from "../src/sanitize.ts";

/** What viem actually produces for a failed JSON-RPC request. */
const VIEM_ERROR = [
  "HTTP request failed.",
  "",
  "Status: 413",
  "URL: https://rpc.example.test/v2/SECRET-API-KEY-0123456789",
  'Request body: {"method":"eth_getLogs","params":[{"fromBlock":"earliest"}]}',
  "",
  "Details: eth_getLogs is limited to a 100 range",
  "Version: viem@2.56.3",
].join("\n");

describe("redactUrls", () => {
  it("removes the URL and the echoed request, and keeps the reason", () => {
    const out = redactUrls(VIEM_ERROR);
    expect(out).not.toContain("SECRET-API-KEY");
    expect(out).not.toContain("rpc.example.test");
    expect(out).not.toContain("Request body");
    expect(out).toContain("eth_getLogs is limited to a 100 range");
    expect(out).toContain("Status: 413");
  });

  it("replaces a URL that appears inside prose, not only on a URL: line", () => {
    const out = redactUrls("Not found: https://rpc.example.test/v2/KEY123, try wss://ws.example.test/KEY456 instead.");
    expect(out).toBe("Not found: <url>, try <url> instead.");
  });

  it("leaves a message with no URL alone", () => {
    expect(redactUrls("PIN_REGISTRY is not set")).toBe("PIN_REGISTRY is not set");
  });

  it("does not leave a gap where lines were dropped", () => {
    expect(redactUrls(VIEM_ERROR)).not.toMatch(/\n{3,}/);
  });

  it("is applied to an Error and to a thrown string", () => {
    expect(safeErrorMessage(new Error(VIEM_ERROR))).not.toContain("SECRET-API-KEY");
    expect(safeErrorMessage("plain https://x.example/KEY")).toBe("plain <url>");
  });
});

describe("escapeCommandData", () => {
  it("encodes the characters that end or alter a workflow command", () => {
    expect(escapeCommandData("a%b\r\nc")).toBe("a%25b%0D%0Ac");
  });

  it("stops a second command being smuggled in after a newline", () => {
    const hostile = "bad selector\n::warning title=Lockstep::capabilities unchanged, safe to merge";
    const line = `::error::${escapeCommandData(hostile)}`;
    expect(line).not.toContain("\n");
    expect(line.split("\n")).toHaveLength(1);
  });
});

describe("workflowErrorCommand, which is what the Action prints for a failure", () => {
  it("is one line, starts with the error command, and carries no URL or API key", () => {
    const command = workflowErrorCommand(new Error(VIEM_ERROR));
    expect(command.startsWith("::error::")).toBe(true);
    expect(command).not.toContain("\n");
    expect(command).not.toContain("SECRET-API-KEY");
    expect(command).not.toContain("rpc.example.test");
    expect(command).toContain("eth_getLogs is limited to a 100 range");
  });

  it("does not let an echoed manifest value start a command of its own", () => {
    const command = workflowErrorCommand(
      new Error("selector must be a function signature, got 'x'\n::warning title=Lockstep::all clear"),
    );
    expect(command.split("\n")).toHaveLength(1);
    expect(command).toContain("%0A::warning");
  });

  it("scrubs before it escapes, so the URL: line is still a line when the filter looks", () => {
    // Escaping first would turn the newline before `URL:` into %0A and the filter would find no line to drop.
    expect(workflowErrorCommand(new Error("failed\nURL: https://rpc.example.test/KEY\nDetails: no"))).toBe(
      "::error::failed%0ADetails: no",
    );
  });
});

describe("escapeMarkdown", () => {
  it("keeps an HTML comment opener visible instead of opening it", () => {
    const escaped = escapeMarkdown("x<!--");
    expect(escaped).toBe("x\\<\\!--");
    expect(escaped).not.toContain("<!--");
  });

  it("escapes the characters that break a table cell or start emphasis, links and code", () => {
    expect(escapeMarkdown("a|b*c_d[e](f)`g~h#i&j")).toBe("a\\|b\\*c\\_d\\[e\\]\\(f\\)\\`g\\~h\\#i\\&j");
  });

  it("flattens newlines so a value cannot start a new block", () => {
    expect(escapeMarkdown("a\nb\r\nc")).toBe("a b c");
  });

  it("leaves an ordinary name and version readable", () => {
    expect(escapeMarkdown("kuru-quote")).toBe("kuru-quote");
    expect(escapeMarkdown("3.0.0")).toBe("3.0.0");
  });
});

describe("inlineCode", () => {
  it("replaces what would end a code span or a table cell", () => {
    expect(inlineCode("balanceOf(address)`|\n<!--")).toBe("balanceOf(address)????!--");
  });

  it("leaves a canonical signature alone", () => {
    expect(inlineCode("transfer(address,uint256)")).toBe("transfer(address,uint256)");
  });
});
