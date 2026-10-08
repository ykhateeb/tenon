import { describe, expect, it } from "vitest";
import { parseSpec, sizeErrors, type Spec } from "./delta.js";

const SPEC = `# Spec: Favorites sorting
Areas: favorites (sdd/areas/favorites.md)

## User stories
### US1 — Sort by date (P1)
- [US1-S1] Given 3 favorites added on different days, When I select "Sort by date", Then the list shows them newest first

### US2 — Newest first by default (P2)
- [US2-S1] Given 3 favorites, When I open the list, Then the newest favorite is at the top

## Delta
### sdd/areas/favorites.md
- ADDED    NEW-R1: Users can sort favorites by date
- ADDED    NEW-Q1: Sort of 500 favorites takes < 100 ms
- MODIFIED FAV-R-002: List shows newest first
    (was: List shows in the order added)
- REMOVED  FAV-R-003: Max 100 favorites
    (why: the limit is not necessary now)

## Open questions
- [OPEN] Sort by name too?
`;

const valueOf = (markdown: string): Spec => {
  const result = parseSpec(markdown);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.value;
};
const errorsOf = (markdown: string): string => {
  const result = parseSpec(markdown);
  return result.ok ? "" : result.errors.join("\n");
};

describe("parseSpec", () => {
  it("reads stories, scenarios, the delta, and open questions", () => {
    const spec = valueOf(SPEC);
    expect(spec.stories).toEqual([
      { id: "US1", title: "Sort by date", priority: 1 },
      { id: "US2", title: "Newest first by default", priority: 2 },
    ]);
    expect(spec.scenarios.map((s) => s.id)).toEqual(["US1-S1", "US2-S1"]);
    expect(spec.delta).toEqual([
      { op: "ADDED", area: "favorites", id: "NEW-R1", text: "Users can sort favorites by date" },
      { op: "ADDED", area: "favorites", id: "NEW-Q1", text: "Sort of 500 favorites takes < 100 ms" },
      { op: "MODIFIED", area: "favorites", id: "FAV-R-002", text: "List shows newest first", was: "List shows in the order added" },
      { op: "REMOVED", area: "favorites", id: "FAV-R-003", text: "Max 100 favorites", why: "the limit is not necessary now" },
    ]);
    expect(spec.openQuestions).toEqual(["Sort by name too?"]);
  });

  it("needs the (was: …) and (why: …) lines", () => {
    expect(errorsOf(SPEC.replace("    (was: List shows in the order added)\n", ""))).toMatch(/\(was: …\)/);
    expect(errorsOf(SPEC.replace("    (why: the limit is not necessary now)\n", ""))).toMatch(/\(why: …\)/);
  });

  it("rejects an ADDED item with a final ID, an item with no area, and a duplicate ID", () => {
    expect(errorsOf(SPEC.replace("ADDED    NEW-R1", "ADDED    FAV-R-009"))).toMatch(/NEW-R1 or NEW-Q1/);
    expect(errorsOf(SPEC.replace("### sdd/areas/favorites.md\n", ""))).toMatch(/heading above/);
    expect(errorsOf(SPEC.replace("NEW-Q1", "NEW-R1"))).toMatch(/NEW-R1 more than one time/);
  });

  it("rejects a duplicate story ID", () => {
    expect(errorsOf(SPEC.replace("### US2 — Newest first by default (P2)", "### US1 — Newest first by default (P2)"))).toMatch(/story US1 is in spec.md more than one time/);
  });

  it("rejects a second, different prefix for a new area", () => {
    const spec = `# Spec: Cards
## User stories
### US1 — Cards (P1)
- [US1-S1] Given a card, When I pay, Then it works

## Baseline (from code)
### sdd/areas/checkout.md (new, prefix CHK)
- BASE-R1: Cart total includes tax.
    Intended? yes

## Delta
### sdd/areas/checkout.md (new, prefix CHE)
- ADDED NEW-R1: Saved cards are offered first
`;
    expect(errorsOf(spec)).toMatch(/checkout has the prefix CHK, not CHE/);
    expect(errorsOf(spec.replace("prefix CHE", "prefix CHK"))).toBe("");
  });

  it("rejects a scenario with no story", () => {
    expect(errorsOf(SPEC.replace("[US2-S1]", "[US9-S1]"))).toMatch(/US9-S1 has no story US9/);
  });

  it("reads a baseline, a coverage line, and a new area", () => {
    const spec = valueOf(`# Spec: Saved cards
## User stories
### US1 — Saved cards first (P1)
- [US1-S1] Given a saved card, When I pay, Then the saved card is first

## Baseline (from code)
### sdd/areas/checkout.md (new, prefix CHK)
- BASE-R1: Cart total includes tax.
    Intended? yes → characterization test
- BASE-R2: Payment fails if the card is expired; error shows "Card expired".
    Defect: the code shows "Payment failed". Intended? no → failing test
Coverage: shipping and coupons have no spec yet

## Delta
### sdd/areas/checkout.md (new, prefix CHK)
- ADDED NEW-R1: Saved cards are offered first
`);
    expect(spec.newAreas).toEqual([{ area: "checkout", prefix: "CHK" }]);
    expect(spec.baseline).toEqual([
      { area: "checkout", id: "BASE-R1", text: "Cart total includes tax.", intended: true, defect: undefined },
      { area: "checkout", id: "BASE-R2", text: 'Payment fails if the card is expired; error shows "Card expired".', intended: false, defect: 'the code shows "Payment failed".' },
    ]);
    expect(spec.coverage).toEqual([{ area: "checkout", text: "shipping and coupons have no spec yet" }]);
  });

  it("reads the Requirement line of a small spec", () => {
    expect(valueOf("# Spec: Order after sync\nArea: favorites   Requirement: FAV-R-002\n").requirement).toBe("FAV-R-002");
  });

  it("accepts CRLF line ends", () => {
    expect(valueOf(SPEC.replaceAll("\n", "\r\n")).delta).toHaveLength(4);
  });

  it("rejects a malformed area heading with a capital letter", () => {
    const errors = errorsOf(SPEC.replace("### sdd/areas/favorites.md", "### sdd/areas/Favorites.md"));
    expect(errors).toMatch(/area heading looks like/);
  });

  it("does not put an item under a bad heading into the area above it", () => {
    const errors = errorsOf(`# Spec: Two areas
## Delta
### sdd/areas/favorites.md
- ADDED NEW-R1: Users can sort favorites by date
### sdd/areas/Lists.md
- ADDED NEW-R2: Users can sort lists
`);
    expect(errors).toMatch(/spec.md line 5: an area heading looks like/);
    expect(errors).toMatch(/spec.md line 6: put a "### sdd\/areas\/<area>.md" heading above the delta item NEW-R2/);
  });

  it("rejects a malformed delta item with no colon", () => {
    expect(errorsOf(SPEC.replace("- MODIFIED FAV-R-002: List shows newest first", "- MODIFIED FAV-R-002 List shows newest first"))).toMatch(/delta item looks like/);
  });

  it("parses a delta with plain text (none) instead of items", () => {
    const result = parseSpec("# Spec: Order\n## Delta\nnone\n");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.delta).toEqual([]);
    }
  });

  it("allows open questions in the delta section", () => {
    const spec = valueOf(`# Spec: Cleanup
## Delta
### sdd/areas/favorites.md
- REMOVED FAV-R-003: Max 100 favorites
    (why: the limit is not necessary)
- [OPEN] Remove FAV-R-003 too?
`);
    expect(spec.openQuestions).toEqual(["Remove FAV-R-003 too?"]);
  });
});

describe("sizeErrors", () => {
  const spec = (patch: Partial<Spec> = {}): Spec => ({ ...valueOf(SPEC), ...patch });
  const modified = valueOf(SPEC).delta.filter((item) => item.op === "MODIFIED");

  it("needs a classification", () => {
    expect(sizeErrors(spec(), {})).toEqual(["Call classify_change to set the type and the size of the change."]);
  });

  it("applies the size and type rules", () => {
    expect(sizeErrors(spec(), { type: "feature", size: "full" })).toEqual([]);
    expect(sizeErrors(spec(), { type: "feature", size: "small" }).join(" ")).toMatch(/always full[\s\S]*empty delta or one MODIFIED/);
    expect(sizeErrors(spec(), { type: "bug", size: "full" })).toEqual(["A bug has an empty delta."]);
    expect(sizeErrors(spec({ delta: [] }), { type: "bug", size: "small" })).toEqual(['A small bug needs the line "Requirement: <ID>".']);
    expect(sizeErrors(spec({ delta: modified, requirement: "FAV-R-002" }), { type: "change", size: "small" })).toEqual([]);
  });
});
