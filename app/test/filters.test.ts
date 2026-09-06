import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Search, filtering and sorting, on the three lists that needed them.
 *
 * The app had none of any of it. On a fixture of six pins that reads as a clean interface; against a real
 * registry it is a table you scroll past. The assertions here are mostly about the two rules that stop a
 * filter becoming a bug report: the active state is always visible, and an empty result says which kind of
 * empty it is.
 */

import { matches } from "@/components/filters";

const APP = join(import.meta.dirname, "..", "src");

const filters = readFileSync(join(APP, "components", "filters.tsx"), "utf8");
const pins = readFileSync(join(APP, "app", "pins", "page.tsx"), "utf8");
const publishers = readFileSync(join(APP, "app", "publishers", "page.tsx"), "utf8");
const approvals = readFileSync(join(APP, "app", "approvals", "page.tsx"), "utf8");

describe("matches", () => {
  it("treats an empty needle as no filter at all", () => {
    // Otherwise every list renders empty until the reader types, which is a blank page that looks broken.
    expect(matches("", "anything")).toBe(true);
    expect(matches("   ", "anything")).toBe(true);
  });

  it("is case-insensitive, because a pasted hash is not", () => {
    // `cast` prints lower case, Etherscan prints mixed case, and a reader pastes whichever they have.
    expect(matches("ABC", "0xabcdef")).toBe(true);
    expect(matches("0xABCDEF", "0xabcdef")).toBe(true);
  });

  it("matches on any field, not all of them", () => {
    expect(matches("kuru", undefined, "kuru-quote", "0x00")).toBe(true);
    expect(matches("kuru", "swiftswap", "0x00")).toBe(false);
  });

  it("skips absent fields rather than throwing on them", () => {
    // A pin's name and version are both optional -- they come from a manifest that may not exist.
    expect(matches("x", undefined, undefined)).toBe(false);
  });
});

describe("the filter bar", () => {
  it("renders active filters as removable chips", () => {
    /*
     * The single most-reported cause of "the dashboard is wrong" is a filter the reader set earlier and
     * forgot: they see a short list, conclude the data is broken, and file a bug against the product. A chip
     * they can see and dismiss makes that impossible, and a filter that lives only inside a dropdown does not.
     */
    expect(filters).toMatch(/chips\.map\(\(chip\)/);
    expect(filters).toMatch(/onClick=\{chip\.onClear\}/);
    expect(filters, "removing a filter is not announced to a screen reader").toMatch(/remove this filter/);
  });

  it("states the count whether or not anything is filtered", () => {
    /*
     * "3 of 12" versus "12". A reader who watches the first number replace the second has been told what
     * changed; one who sees a number appear from nowhere has to work out whether it is a new fact or a
     * narrowed one -- and on this product, "the registry has 3 pins" is a conclusion someone might act on.
     */
    expect(filters).toMatch(/Showing \$\{showing\} of \$\{total\} \$\{noun\}/);
    expect(filters).toMatch(/aria-live="polite"/);
  });

  it("offers a clear-all only when there is more than one filter to clear", () => {
    // With one chip, "Clear all" and the chip's own × do the same thing, and two controls for one outcome is
    // how a reader starts wondering whether they differ.
    expect(filters).toMatch(/chips\.length > 1 \?/);
  });

  it("distinguishes an empty result from an empty registry", () => {
    /*
     * The mistake this exists to prevent. "No pins have been published" and "no pins match what you typed" are
     * different facts, and showing the first when the second is true tells a reader the registry is empty when
     * they have simply mistyped a hash.
     */
    expect(filters).toMatch(/filtered && showing === 0/);
    expect(filters).toMatch(/clear the filters above/);
  });

  it("sets the field in monospace", () => {
    // Most of what gets typed in here is a hash or an address pasted from elsewhere, and a proportional face
    // makes those impossible to compare against the column being matched.
    expect(filters).toMatch(/\smono\s*\/>/);
  });
});

describe("pins", () => {
  it("searches the hash and the publisher, not only the name", () => {
    /*
     * How a reader arrives with a pin: pasted from a CI log, a README badge, or the CLI. A name-only search
     * refuses the identifier the product itself hands out.
     */
    expect(pins).toMatch(/pin\.skillHash,/);
    expect(pins).toMatch(/pin\.versionId,/);
    expect(pins).toMatch(/pin\.publisher,/);
  });

  it("keeps the detail panel showing something that is still in the list", () => {
    /*
     * A panel describing a pin that has been filtered out of the list beside it is a panel a reader cannot
     * connect to anything. Falling back to `snapshot.pins[0]` would do exactly that.
     */
    expect(pins).toMatch(/visible\.find\(\(p\) => p\.pinId === selectedId\) \?\? visible\[0\]/);
  });

  it("keeps the filter out of the URL and the selection in it", () => {
    /*
     * A selected pin is worth sending someone. A search box's contents is not: a link that arrives
     * pre-narrowed to three of twelve rows, with no explanation, is the "the dashboard is wrong" bug
     * reproduced on purpose.
     */
    expect(pins).toMatch(/url\.searchParams\.set\("pin", pinId\)/);
    expect(pins, "the search term is being written to the URL").not.toMatch(/searchParams\.set\("(q|search)"/);
  });
});

describe("publishers", () => {
  it("keeps bond as the default order", () => {
    /*
     * The page's argument. Reputation here is not a score anyone assigned, it is how much a publisher stands
     * to lose, so the default sort has to be the one that says that. Sorting is added; the default is not
     * changed.
     */
    expect(publishers).toMatch(/useState<SortKey>\("bond"\)/);
  });

  it("copies before sorting", () => {
    /*
     * `publishers` comes off the shared snapshot every page reads and `Array.prototype.sort` mutates in place.
     * Without the copy, sorting this table silently reorders the one on the dashboard.
     */
    // `\s*` rather than `\n\s*`: this repo's working copies are CRLF, and a regex that only accepts `\n`
    // passes on a freshly written file and fails after the next checkout, which is a test that lies about
    // whether the code is correct.
    expect(publishers).toMatch(/\.slice\(\)\s*\.sort\(/);
  });

  it("announces the current sort rather than only colouring it", () => {
    // A coloured arrow tells a screen reader nothing. `aria-pressed` is what makes the state audible.
    expect(publishers).toMatch(/aria-pressed=\{on\}/);
  });

  it("reserves the marker's space in both states", () => {
    // Otherwise switching columns shifts the whole header row sideways, which reads as the table twitching.
    expect(publishers).toMatch(/on \? "opacity-100" : "opacity-0"/);
  });
});

describe("approvals", () => {
  it("filters both lists from one field", () => {
    /*
     * Two boxes would be the obvious build and the wrong one: the two lists are the same subject seen twice,
     * so a reader typing a skill name wants both narrowed. Filtering one while the other keeps every row is
     * how a reader concludes the second table is about something else.
     */
    expect(approvals).toMatch(/visibleApprovals/);
    expect(approvals).toMatch(/visibleExecutions/);
    const bars = approvals.match(/<FilterBar/g) ?? [];
    expect(bars, "there is more than one search field on this page").toHaveLength(1);
  });

  it("does not claim the account has never executed anything when a search filtered it out", () => {
    /*
     * The `Empty` state on this section states a fact about the account. Showing it to someone who mistyped a
     * hash would be a false statement about their account, on the page whose whole job is to be an accurate
     * record of it.
     */
    expect(approvals).toMatch(/visibleExecutions\.length === 0 \?/);
    expect(approvals).toMatch(/No execution matches the search above/);
  });
});
