import { describe, expect, it } from "vitest";
import { applyChange, newArea, parseAreaSpec, renderAreaSpec, staleErrors, type AreaSpec } from "./area-spec.js";
import type { DeltaItem } from "./delta.js";

const AREA = `# Area spec: Favorites
Prefix: FAV   Next IDs: FAV-R-005, FAV-Q-002

## Current behavior
- FAV-R-001: Users can add and remove a favorite.  (since 2026-09-14-favorites)
- FAV-R-002: List shows in the order added  (since 2026-09-14-favorites)
- FAV-R-003: Max 100 favorites  (since 2026-09-14-favorites)
- FAV-R-004: Favorites sync across devices.  (since 2026-09-14-favorites)

## Quality requirements
- FAV-Q-001: List opens in < 500 ms with 100 items.  (since 2026-09-14-favorites)

## Tests
- FAV-R-001 → favorites-us1-s1
- FAV-R-002 → favorites-us1-s2-order-added
- FAV-R-003 → favorites-us1-s4-limit

## History
- 2026-09-14-favorites: created the area
`;

const DELTA: DeltaItem[] = [
  { op: "ADDED", area: "favorites", id: "NEW-R1", text: "Users can sort favorites by date" },
  { op: "ADDED", area: "favorites", id: "NEW-Q1", text: "Sort of 500 favorites takes < 100 ms" },
  { op: "MODIFIED", area: "favorites", id: "FAV-R-002", text: "List shows newest first", was: "List shows in the order added" },
  { op: "REMOVED", area: "favorites", id: "FAV-R-003", text: "Max 100 favorites", why: "not necessary" },
];

const area = (): AreaSpec => {
  const result = parseAreaSpec(AREA);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.value;
};

describe("parseAreaSpec and renderAreaSpec", () => {
  it("give back the same text", () => {
    expect(renderAreaSpec(area())).toBe(AREA);
  });

  it("need a title and a prefix line", () => {
    const result = parseAreaSpec("## Current behavior\n");
    expect(result.ok ? "" : result.errors.join("\n")).toMatch(/# Area spec[\s\S]*Prefix/);
  });
});

describe("applyChange", () => {
  const change = {
    folder: "2026-10-08-favorites-sorting",
    delta: DELTA,
    baseline: [],
    coverage: undefined,
    tests: [
      { id: "NEW-R1", test: "favorites-sorting-us1-s1" },
      { id: "FAV-R-002", test: "favorites-sorting-us2-s1" },
      { id: "NEW-Q1", test: "sort-perf" },
    ],
  };

  it("gives final IDs and applies ADDED, MODIFIED, and REMOVED", () => {
    const { area: next, ids } = applyChange(area(), change);
    expect([...ids]).toEqual([["NEW-R1", "FAV-R-005"], ["NEW-Q1", "FAV-Q-002"]]);
    const text = renderAreaSpec(next);
    expect(text).toContain("Prefix: FAV   Next IDs: FAV-R-006, FAV-Q-003");
    expect(text).toContain("- FAV-R-002: List shows newest first  (since 2026-10-08-favorites-sorting; was: List shows in the order added)");
    expect(text).toContain("- FAV-R-005: Users can sort favorites by date  (since 2026-10-08-favorites-sorting)");
    expect(text).toContain("- FAV-Q-002: Sort of 500 favorites takes < 100 ms  (since 2026-10-08-favorites-sorting)");
    expect(text).not.toContain("FAV-R-003");
    expect(next.history[0]).toBe("2026-10-08-favorites-sorting: ADDED FAV-R-005, FAV-Q-002; MODIFIED FAV-R-002; REMOVED FAV-R-003");
  });

  it("replaces the test links of a MODIFIED requirement and drops the links of a REMOVED one", () => {
    expect(applyChange(area(), change).area.tests).toEqual([
      { id: "FAV-Q-002", test: "sort-perf" },
      { id: "FAV-R-001", test: "favorites-us1-s1" },
      { id: "FAV-R-002", test: "favorites-sorting-us2-s1" },
      { id: "FAV-R-005", test: "favorites-sorting-us1-s1" },
    ]);
  });

  it("never uses a REMOVED ID again", () => {
    const removed = applyChange(area(), { ...change, delta: [{ op: "REMOVED", area: "favorites", id: "FAV-R-004", text: "Favorites sync across devices.", why: "x" }], tests: [] });
    const added = applyChange(removed.area, { ...change, folder: "2026-10-09-next", delta: [DELTA[0]], tests: [] });
    expect([...added.ids]).toEqual([["NEW-R1", "FAV-R-005"]]);
  });

  it("adds only a test link and a history line for a bug", () => {
    const { area: next } = applyChange(area(), { ...change, folder: "2026-10-08-fix", delta: [], tests: [{ id: "FAV-R-002", test: "fix-us1-s1" }] });
    expect(next.tests).toContainEqual({ id: "FAV-R-002", test: "fix-us1-s1" });
    expect(next.tests).toContainEqual({ id: "FAV-R-002", test: "favorites-us1-s2-order-added" });
    expect(next.history[0]).toBe("2026-10-08-fix: tests for FAV-R-002");
  });

  it("adds a baseline to a new area, and a MODIFIED item can change a baseline item", () => {
    const { area: next, ids } = applyChange(newArea("checkout", "CHK"), {
      folder: "2026-10-08-saved-cards",
      baseline: [
        { area: "checkout", id: "BASE-R1", text: "Cart total includes tax.", intended: true, defect: undefined },
        { area: "checkout", id: "BASE-R2", text: "Card error shows Payment failed", intended: true, defect: undefined },
      ],
      delta: [
        { op: "MODIFIED", area: "checkout", id: "BASE-R2", text: "Card error shows Card expired", was: "Card error shows Payment failed" },
        { op: "ADDED", area: "checkout", id: "NEW-R1", text: "Saved cards are offered first" },
      ],
      coverage: "shipping has no spec yet",
      tests: [{ id: "NEW-R1", test: "saved-cards-us1-s1" }],
    });
    expect([...ids]).toEqual([["BASE-R1", "CHK-R-001"], ["BASE-R2", "CHK-R-002"], ["NEW-R1", "CHK-R-003"]]);
    expect(next.title).toBe("Checkout");
    expect(next.coverage).toEqual(["shipping has no spec yet"]);
    expect(renderAreaSpec(next)).toContain("- CHK-R-002: Card error shows Card expired  (since 2026-10-08-saved-cards; was: Card error shows Payment failed)");
    expect(next.history[0]).toBe("2026-10-08-saved-cards: baseline CHK-R-001, CHK-R-002; ADDED CHK-R-003; MODIFIED CHK-R-002");
  });
});

describe("staleErrors", () => {
  it("finds a requirement that changed or went away, and skips ADDED and baseline items", () => {
    const changed = { ...area(), behavior: area().behavior.map((r) => (r.id === "FAV-R-002" ? { ...r, text: "List shows alphabetically" } : r)) };
    expect(staleErrors(changed, DELTA)).toEqual(['FAV-R-002 changed in the area spec: it says "List shows alphabetically", and the delta expects "List shows in the order added".']);
    expect(staleErrors({ ...area(), behavior: [] }, DELTA)).toEqual(["FAV-R-002 is not in the area spec any more.", "FAV-R-003 is not in the area spec any more."]);
    expect(staleErrors(area(), [{ op: "MODIFIED", area: "favorites", id: "BASE-R1", text: "x", was: "y" }])).toEqual([]);
  });
});
