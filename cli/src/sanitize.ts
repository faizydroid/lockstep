/**
 * Output hygiene, shared by the CLI and the GitHub Action.
 *
 * Three things that go wrong when text from somewhere else is printed into a place that gives some
 * characters a meaning, found by auditing what `lockstep` and the Action write out:
 *
 *   - An RPC error carries the RPC's URL, and URLs often carry an API key in the path
 *     (`https://rpc.example/v2/<key>`). viem's messages include a `URL:` line and echo the request body,
 *     so the key landed in a CI log anyone with read access can see, or in a terminal being screen-shared.
 *   - The runner parses `::error::...` lines as commands, and newlines in the message end the command and
 *     start a new one. A message that echoes attacker-chosen text can therefore emit its own annotations.
 *   - The step summary is Markdown, and a pull request can choose the strings (`name`, a selector label)
 *     that are interpolated into it. One of them was enough to open an HTML comment around the two real
 *     high-risk rows of a capability table.
 *
 * None of these is exploitable for money. They are the kind of thing a security tool must not do.
 */

/**
 * Removes the places an RPC error echoes the request and replaces any URL left.
 *
 * Keeps the rest of the message, because "eth_getLogs is limited to a 100 range" is the part someone
 * needs. Lines are dropped, not blanked, so the output does not gain empty gaps.
 */
export function redactUrls(message: string): string {
  return message
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:URL|Request body|Request Arguments)\s*:/i.test(line))
    .join("\n")
    // The URL stops before trailing punctuation, so "see https://x.example/KEY." keeps its full stop.
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>)\]]*[^\s"'<>)\],.;:!?]/gi, "<url>")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A thrown value as a safe single message. */
export function safeErrorMessage(error: unknown): string {
  return redactUrls(error instanceof Error ? error.message : String(error));
}

/**
 * Escapes text for the data part of a workflow command, as `@actions/core` does: `%`, CR and LF.
 * Without it a newline ends the command and whatever follows is parsed as a new one.
 */
export function escapeCommandData(text: string): string {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * The runner command that reports a failure, for anything `main()` throws.
 *
 * The message is scrubbed of RPC URLs and then escaped, in that order: escaping first would turn the
 * newline that separates viem's `URL:` line from the rest into `%0A`, and the line filter would no
 * longer see a line to drop.
 */
export function workflowErrorCommand(error: unknown): string {
  return `::error::${escapeCommandData(safeErrorMessage(error))}`;
}

/**
 * Escapes text so Markdown renders it literally: no emphasis, no links, no HTML, no table cell breaks.
 *
 * Backslash-escapes the punctuation CommonMark treats as significant. It renders as the plain text, so a
 * version string like `1.0.0` or a name like `kuru-quote` looks the same to a reader, and `<!--` stays
 * visible instead of opening a comment.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]()<>|&~#!]/g, "\\$&").replace(/\r?\n/g, " ");
}

/**
 * Text for inside an inline code span in a table cell. A code span cannot be backslash-escaped, so the
 * characters that would end it or the cell are replaced instead.
 */
export function inlineCode(text: string): string {
  return text.replace(/[`|<>\r\n]/g, "?");
}
