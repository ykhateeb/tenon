import { describe, expect, it } from "vitest";
import type { Spec } from "./delta.js";
import { consistencyErrors, parsePlan, type Task } from "./plan.js";

const PLAN = `# Plan: Favorites sorting

## Tasks
### Phase 1 — Foundation
- [x] T001 (test) [GET /favorites] Contract test in contracts/favorites.test.ts
- [ ] T002 [NEW-R1] Sort parameter in api/favorites.ts
- [ ] T003 [FAV-R-003] Remove the 100-favorites limit in api/favorites.ts
### Phase 2 — US1 Sort by date (P1)
- [ ] T004 (test) [P] [US1-S1] E2E test in e2e/favorites-sorting-us1-s1.e2e.ts; delete e2e/old
- [ ] T005 (test) [P] [NEW-Q1] Performance test in logic/sort.perf.test.ts
- [ ] T006 [US1-S1, NEW-R1] Sort control in FavoritesList.tsx
`;

const SPEC: Spec = {
  stories: [{ id: "US1", title: "Sort by date", priority: 1 }, { id: "US2", title: "Newest first", priority: 1 }],
  scenarios: [{ id: "US1-S1", story: "US1", text: "x" }, { id: "US2-S1", story: "US2", text: "y" }],
  delta: [
    { op: "ADDED", area: "favorites", id: "NEW-R1", text: "a" },
    { op: "ADDED", area: "favorites", id: "NEW-Q1", text: "b" },
    { op: "MODIFIED", area: "favorites", id: "FAV-R-002", text: "c", was: "d" },
    { op: "REMOVED", area: "favorites", id: "FAV-R-003", text: "e", why: "f" },
  ],
  baseline: [],
  newAreas: [],
  coverage: [],
  openQuestions: [],
  requirement: undefined,
};

const tasks = (): Task[] => {
  const result = parsePlan(PLAN);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.value;
};

describe("parsePlan", () => {
  it("reads each task line", () => {
    expect(tasks()[3]).toEqual({
      id: "T004",
      done: false,
      isTest: true,
      isParallel: true,
      refs: ["US1-S1"],
      file: "e2e/favorites-sorting-us1-s1.e2e.ts",
      phase: "Phase 2 — US1 Sort by date (P1)",
    });
    expect(tasks()[0]).toMatchObject({ done: true, refs: ["GET /favorites"], file: "contracts/favorites.test.ts" });
    expect(tasks()[5].refs).toEqual(["US1-S1", "NEW-R1"]);
  });

  it("needs at least one task", () => {
    expect(parsePlan("# Plan\n").ok).toBe(false);
  });
});

describe("consistencyErrors", () => {
  it("names delta IDs with no task and scenarios with no test task", () => {
    expect(consistencyErrors(tasks(), SPEC)).toEqual(["No task names FAV-R-002.", "No (test) task names US2-S1."]);
  });

  it("finds two parallel tasks that change the same file", () => {
    const clash = parsePlan(PLAN.replace("logic/sort.perf.test.ts", "e2e/favorites-sorting-us1-s1.e2e.ts"));
    expect(clash.ok && consistencyErrors(clash.value, SPEC)).toContain("T004 and T005 run in parallel but both change e2e/favorites-sorting-us1-s1.e2e.ts.");
  });
});
