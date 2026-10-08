import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { State } from "../entities/state.js";
import { createFakeProject } from "../testing/fake-project.js";
import { createFakeAgent, createFakePerson, testDeps } from "../testing/fakes.js";
import { changeOf, readRules } from "./change.js";
import { exitErrors, runFullTier } from "./exit-checks.js";

const DIR = "sdd/changes/2026-10-08-sort";
const SPEC = `# Spec: Sort
## User stories
### US1 — Sort by date (P1)
- [US1-S1] Given favorites, When I sort, Then the newest is first

## Delta
### sdd/areas/favorites.md
- ADDED NEW-R1: Users can sort favorites by date
- MODIFIED FAV-R-002: List shows newest first
    (was: List shows in the order added)
`;
const TRACE = (evidence = "") => `# Traceability: Sort
| ID | Scenario | Level | Test | Status | Evidence | Verdict |
|---|---|---|---|---|---|---|
| NEW-R1 | US1-S1 | Unit | tests/sort-us1-s1 |  | ${evidence} |  |
| FAV-R-002 | US1-S1 | Unit | tests/sort-us1-s1 |  | ${evidence} |  |
`;
const state = (patch: Partial<State>): State => ({ owner: "Sam", base: "main", request: "Sort", size: "full", type: "feature", specVersion: 1, stage: "spec", reviewRounds: 0, gates: [], ...patch });

function setup() {
  const project = createFakeProject();
  const deps = testDeps(project, createFakeAgent(async () => {}).agent, createFakePerson({}).person);
  const change = changeOf(project.root, "sdd/2026-10-08-sort");
  if (!change) throw new Error("bad branch name");
  return { project, deps, change };
}

describe("exitErrors", () => {
  it("checks the spec: open questions, the classification, and the dry run of the delta", async () => {
    const { project, deps, change } = setup();
    project.write(`${DIR}/spec.md`, `${SPEC}- [OPEN] Sort by name too?\n`);
    const rules = await readRules(project.root);
    expect(await exitErrors(deps, change, state({ size: undefined, type: undefined }), rules)).toEqual([
      'An open question is left: "Sort by name too?". Ask the owner with ask_owner, and write the answer into the spec.',
      "Call classify_change to set the type and the size of the change.",
    ]);
    project.write(`${DIR}/spec.md`, SPEC.replace("(was: List shows in the order added)", "(was: something else)"));
    expect(await exitErrors(deps, change, state({}), rules)).toEqual(['FAV-R-002 changed in the area spec: it says "List shows in the order added", and the delta expects "something else".']);
    project.write(`${DIR}/spec.md`, SPEC);
    expect(await exitErrors(deps, change, state({}), rules)).toEqual([]);
  });

  it("wants each new test to fail before the build, and fills the status", async () => {
    const { project, deps, change } = setup();
    project.write(`${DIR}/spec.md`, SPEC);
    project.write(`${DIR}/plan.md`, "## Tasks\n- [x] T001 (test) [US1-S1] Test in tests/sort.txt\n- [ ] T002 [NEW-R1, FAV-R-002] Sort in src/sort.txt\n");
    project.write(`${DIR}/traceability.md`, TRACE());
    project.write("tests/sort.txt", "sort-us1-s1|src/sort.txt\n");
    const rules = await readRules(project.root);
    expect(await exitErrors(deps, change, state({ stage: "tests" }), rules)).toEqual([]);
    expect(project.read(`${DIR}/traceability.md`)).toContain("| failing (expected) |");
    project.write("src/sort.txt", "too early\n");
    expect((await exitErrors(deps, change, state({ stage: "tests" }), rules)).join("\n")).toMatch(/"passing", and it must be "failing \(expected\)"/);
  });

  it("wants each task ticked, each test passing, and evidence that exists in Build", async () => {
    const { project, deps, change } = setup();
    project.write(`${DIR}/plan.md`, "## Tasks\n- [x] T001 (test) [US1-S1] Test in tests/sort.txt\n- [x] T002 [NEW-R1, FAV-R-002] Sort in src/sort.txt\n");
    project.write("tests/sort.txt", "sort-us1-s1|src/sort.txt\n");
    project.write("src/sort.txt", "sorted\n");
    project.write(`${DIR}/traceability.md`, TRACE("src/missing.txt"));
    const rules = await readRules(project.root);
    expect((await exitErrors(deps, change, state({ stage: "build" }), rules)).join("\n")).toMatch(/evidence is "src\/missing.txt"/);
    project.write(`${DIR}/traceability.md`, TRACE("src/sort.txt"));
    expect(await exitErrors(deps, change, state({ stage: "build" }), rules)).toEqual([]);
    expect(project.read(`${DIR}/traceability.md`)).toContain("| passing | src/sort.txt | met |");
  });
});

describe("exitErrors in pass mode", () => {
  it("wants each test to pass for a refactor or a chore", async () => {
    const { project, deps, change } = setup();
    project.write(`${DIR}/spec.md`, SPEC);
    project.write(`${DIR}/plan.md`, "## Tasks\n- [x] T001 (test) [US1-S1] Test in tests/sort.txt\n- [ ] T002 [NEW-R1, FAV-R-002] Sort in src/sort.txt\n");
    project.write(`${DIR}/traceability.md`, TRACE());
    project.write("tests/sort.txt", "sort-us1-s1|src/sort.txt\n");
    const rules = await readRules(project.root);
    expect((await exitErrors(deps, change, state({ stage: "tests", type: "refactor" }), rules)).join("\n")).toMatch(/"failing", and it must be "passing"/);
    project.write("src/sort.txt", "sorted\n");
    expect(await exitErrors(deps, change, state({ stage: "tests", type: "chore" }), rules)).toEqual([]);
    expect(project.read(`${DIR}/traceability.md`)).toContain("| passing |");
  });
});

describe("buildErrors", () => {
  it("runs the mutation command only when the other checks pass", async () => {
    const { project, deps, change } = setup();
    project.write(`${DIR}/plan.md`, "## Tasks\n- [x] T001 (test) [US1-S1] Test in tests/sort.txt\n- [x] T002 [NEW-R1, FAV-R-002] Sort in src/sort.txt\n");
    project.write("tests/sort.txt", "sort-us1-s1|src/sort.txt\n");
    project.write("src/sort.txt", "sorted\n");
    project.write(`${DIR}/traceability.md`, TRACE("src/missing.txt"));
    const rules = { ...(await readRules(project.root)), mutation: "touch mutation-ran && exit 1" };
    expect((await exitErrors(deps, change, state({ stage: "build" }), rules)).join("\n")).not.toMatch(/mutation/);
    expect(existsSync(join(project.root, "mutation-ran"))).toBe(false);
    project.write(`${DIR}/traceability.md`, TRACE("src/sort.txt"));
    expect((await exitErrors(deps, change, state({ stage: "build" }), rules)).join("\n")).toMatch(/The mutation command failed/);
    expect(await exitErrors(deps, change, state({ stage: "build" }), { ...rules, mutation: "true" })).toEqual([]);
  });
});

describe("runFullTier", () => {
  it("ignores a stale report from an earlier run", async () => {
    const { project, deps } = setup();
    project.write("reports/old.xml", '<testsuites><testcase name="sort-us1-s1"/></testsuites>');
    project.write("fake-tests.mjs", "process.exit(2);\n");
    const tier = await runFullTier(deps, await readRules(project.root));
    expect(tier.cases).toEqual([]);
    expect(tier.errors[0]).toMatch(/wrote no JUnit report that matches reports\/\*\.xml/);
  });
});
