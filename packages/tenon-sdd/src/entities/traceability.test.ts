import { describe, expect, it } from "vitest";
import type { Spec } from "./delta.js";
import { buildStageErrors, parseTraceability, renderTraceability, requirementLinks, testsStageErrors, withStatuses, withVerdicts, type Row, type TestCase, type Traceability } from "./traceability.js";

const TRACE = `# Traceability: Favorites sorting
| ID | Scenario | Level | Test | Status | Evidence | Verdict |
|---|---|---|---|---|---|---|
| NEW-R1 | US1-S1 | E2E | e2e/favorites-sorting-us1-s1 |  |  |  |
| FAV-R-002 | US2-S1 | E2E | e2e/favorites-sorting-us2-s1 (replaces e2e/favorites-us1-s2-order-added) |  |  |  |
| NEW-Q1 | Performance | Unit | logic/sort-perf |  |  |  |
| FAV-R-003 | REMOVED | — | e2e/favorites-us1-s4-limit deleted |  |  |  |

Notes for review: none`;

const CASES: TestCase[] = [
  { name: "sorts newest first [favorites-sorting-us1-s1]", className: "e2e/sort.e2e.ts", result: "failed" },
  { name: "newest at top", className: "e2e/favorites-sorting-us2-s1.e2e.ts", result: "failed" },
  { name: "sort-perf under 100 ms", className: "logic", result: "skipped" },
];

const SPEC = {
  scenarios: [{ id: "US1-S1", story: "US1", text: "" }, { id: "US2-S1", story: "US2", text: "" }, { id: "US3-S1", story: "US3", text: "" }],
  delta: [{ op: "ADDED", area: "favorites", id: "NEW-R1", text: "" }, { op: "ADDED", area: "favorites", id: "NEW-R2", text: "" }],
} as Spec;

const trace = (markdown = TRACE): Traceability => {
  const result = parseTraceability(markdown);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.value;
};
const statuses = (rows: readonly Row[]) => rows.map((row) => row.status);

describe("parseTraceability and renderTraceability", () => {
  it("keep the head, the rows, and the footer", () => {
    const parsedTrace = trace();
    expect(parsedTrace.rows).toHaveLength(4);
    expect(parsedTrace.footer).toEqual(["", "Notes for review: none"]);
    expect(renderTraceability(parsedTrace)).toBe(TRACE);
  });

  it("keep the first row when the separator line is missing", () => {
    const lines = TRACE.split("\n");
    expect(trace(lines.filter((_line, index) => index !== 2).join("\n")).rows.map((row) => row.id)).toEqual(["NEW-R1", "FAV-R-002", "NEW-Q1", "FAV-R-003"]);
  });

  it("need the table with the fixed columns", () => {
    expect(parseTraceability("# Traceability\n| ID | Test |\n").ok).toBe(false);
  });
});

describe("withStatuses", () => {
  it("expects new tests to fail first, and a deleted test to be gone", () => {
    expect(statuses(withStatuses(trace().rows, CASES, "fail-first"))).toEqual(["failing (expected)", "failing (expected)", "skipped", "—"]);
  });

  it("finds a deleted test that still runs and a test that is not there", () => {
    const cases: TestCase[] = [{ name: "favorites-us1-s4-limit", className: "e2e", result: "passed" }];
    expect(statuses(withStatuses(trace().rows, cases, "pass"))).toEqual(["not found", "not found", "not found", "still runs"]);
  });
});

describe("testsStageErrors", () => {
  it("names missing rows and each row with the wrong status", () => {
    const rows = withStatuses(trace().rows, CASES, "fail-first");
    expect(testsStageErrors(rows, SPEC, "fail-first")).toEqual([
      "No row for the scenario US3-S1.",
      "No row for NEW-R2.",
      'NEW-Q1 Performance: logic/sort-perf is "skipped", and it must be "failing (expected)".',
    ]);
  });

  it("wants each test to pass for a refactor, and each characterization test to pass", () => {
    const rows = withStatuses(trace().rows, CASES, "pass").slice(0, 1);
    expect(testsStageErrors(rows, { ...SPEC, scenarios: SPEC.scenarios.slice(0, 1), delta: [] }, "pass")).toEqual(['NEW-R1 US1-S1: e2e/favorites-sorting-us1-s1 is "failing", and it must be "passing".']);
    const characterization = withStatuses([{ ...trace().rows[0], level: "Characterization" }], CASES, "fail-first");
    expect(characterization[0].status).toBe("failing");
  });

  it("accepts a passing or an expected failing test after Build, but not a skipped one", () => {
    const cases: TestCase[] = [{ ...CASES[0], result: "passed" }, CASES[1], CASES[2]];
    const rows = withStatuses(trace().rows, cases, "after-build");
    expect(statuses(rows)).toEqual(["passing", "failing (expected)", "skipped", "—"]);
    expect(testsStageErrors(rows, { ...SPEC, scenarios: SPEC.scenarios.slice(0, 2), delta: [] }, "after-build")).toEqual([
      'NEW-Q1 Performance: logic/sort-perf is "skipped", and it must be "passing" or "failing (expected)".',
    ]);
  });
});

describe("withVerdicts and buildStageErrors", () => {
  const passing: TestCase[] = CASES.map((testCase) => ({ ...testCase, result: "passed" }));

  it("sets met only for a passing test with evidence files that exist", () => {
    const rows = withStatuses(trace().rows, passing, "pass").map((row, index) => ({ ...row, evidence: index === 0 ? "src/sort.ts" : index === 1 ? "src/missing.ts" : "" }));
    const judged = withVerdicts(rows, (path) => path === "src/sort.ts");
    expect(judged.map((row) => row.verdict)).toEqual(["met", "missing", "missing", "—"]);
    expect(buildStageErrors(judged)).toEqual([
      'FAV-R-002 US2-S1: the test is "passing", and the evidence is "src/missing.ts".',
      'NEW-Q1 Performance: the test is "passing", and the evidence is "empty".',
    ]);
  });

  it("refuses an extra row", () => {
    const extra: Row = { id: "—", scenario: "—", level: "—", test: "—", status: "", evidence: "src/analytics.ts", verdict: "extra" };
    expect(buildStageErrors([extra])).toEqual(["Extra code with no requirement: src/analytics.ts. Remove it, or use request_return to add it to the spec."]);
  });
});

describe("requirementLinks", () => {
  it("links each requirement row to the key of its test", () => {
    expect(requirementLinks(trace().rows)).toEqual([
      { id: "NEW-R1", test: "favorites-sorting-us1-s1" },
      { id: "FAV-R-002", test: "favorites-sorting-us2-s1" },
      { id: "NEW-Q1", test: "sort-perf" },
    ]);
  });
});
