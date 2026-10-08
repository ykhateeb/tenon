import { describe, expect, it } from "vitest";
import { AREA, createFakeProject } from "../testing/fake-project.js";
import { createFakeAgent, createFakePerson, testDeps } from "../testing/fakes.js";
import { readState } from "./change.js";
import { shipApply } from "./ship-apply.js";
import { startChange } from "./start-change.js";

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
const BUG_SPEC = "# Spec: Order after sync\nArea: favorites   Requirement: FAV-R-002\n\n## User stories\n### US1 — Order (P1)\n- [US1-S1] Given synced favorites, When I open the list, Then they keep the order\n";
const trace = (id: string, test: string) => `# Traceability
| ID | Scenario | Level | Test | Status | Evidence | Verdict |
|---|---|---|---|---|---|---|
| ${id} | US1-S1 | Unit | tests/${test} | passing | src/x.txt | met |
`;

async function started(spec: string, rows: string) {
  const project = createFakeProject();
  const deps = testDeps(project, createFakeAgent(async () => {}).agent, createFakePerson({}).person);
  const change = await startChange(deps, { request: "Sort", slug: "sort" });
  project.write(`${change.dir}/spec.md`, spec);
  project.write(`${change.dir}/traceability.md`, rows);
  project.run("add", "-A");
  project.run("commit", "-q", "-m", "spec and tests");
  return { project, deps, change, state: { ...(await readState(change)), type: "feature" as const, size: "full" as const } };
}

describe("shipApply", () => {
  it("gives final IDs and writes the area spec from the base version", async () => {
    const { project, deps, change, state } = await started(SPEC, trace("NEW-R1", "sort-us1-s1"));
    const result = await shipApply(deps, change, state);
    expect(result.errors).toEqual([]);
    expect([...result.ids]).toEqual([["NEW-R1", "FAV-R-005"]]);
    const area = project.read("sdd/areas/favorites.md");
    expect(area).toContain("- FAV-R-005: Users can sort favorites by date  (since 2026-10-08-sort)");
    expect(area).toContain("- FAV-R-005 → sort-us1-s1");
    expect(area).toContain("- 2026-10-08-sort: ADDED FAV-R-005; MODIFIED FAV-R-002");
  });

  it("gives the same result when it runs again", async () => {
    const { project, deps, change, state } = await started(SPEC, trace("NEW-R1", "sort-us1-s1"));
    await shipApply(deps, change, state);
    const first = project.read("sdd/areas/favorites.md");
    await shipApply(deps, change, state);
    expect(project.read("sdd/areas/favorites.md")).toBe(first);
  });

  it("writes nothing when the base changed a MODIFIED requirement", async () => {
    const { project, deps, change, state } = await started(SPEC, trace("NEW-R1", "sort-us1-s1"));
    project.run("switch", "-q", "main");
    project.write("sdd/areas/favorites.md", AREA.replace("List shows in the order added", "List shows in alphabetical order"));
    project.run("commit", "-qam", "change FAV-R-002 on main");
    project.run("switch", "-q", "sdd/2026-10-08-sort");
    const result = await shipApply(deps, change, state);
    expect(result.errors).toEqual(['FAV-R-002 changed in the area spec: it says "List shows in alphabetical order", and the delta expects "List shows in the order added".']);
    expect(project.read("sdd/areas/favorites.md")).toBe(AREA);
  });

  it("adds only a test link and a history line for a small bug", async () => {
    const { project, deps, change, state } = await started(BUG_SPEC, trace("FAV-R-002", "fix-us1-s1"));
    const result = await shipApply(deps, change, { ...state, type: "bug", size: "small" });
    expect(result.errors).toEqual([]);
    const area = project.read("sdd/areas/favorites.md");
    expect(area).toContain("- FAV-R-002 → fix-us1-s1");
    expect(area).toContain("- 2026-10-08-sort: tests for FAV-R-002");
  });

  it("needs no traceability for docs", async () => {
    const { project, deps, change, state } = await started("# Spec: Docs\n", "no table");
    expect(await shipApply(deps, change, { ...state, type: "docs", size: "small" })).toEqual({ errors: [], ids: new Map() });
    expect(project.read("sdd/areas/favorites.md")).toBe(AREA);
  });

  it("reports a test link for a prefix with no area", async () => {
    const { project, deps, change, state } = await started(BUG_SPEC, trace("ZZZ-R-001", "fix-us1-s1"));
    const result = await shipApply(deps, change, { ...state, type: "bug", size: "small" });
    expect(result.errors).toEqual([
      "ZZZ-R-001 has a test, but no area spec has the prefix ZZZ.",
    ]);
    expect(project.read("sdd/areas/favorites.md")).toBe(AREA);
  });

  it("reports a test link for a missing requirement", async () => {
    const { project, deps, change, state } = await started(BUG_SPEC, trace("FAV-R-099", "fix-us1-s1"));
    const result = await shipApply(deps, change, { ...state, type: "bug", size: "small" });
    expect(result.errors).toEqual([
      "FAV-R-099 has a test, but sdd/areas/favorites.md has no FAV-R-099.",
    ]);
    expect(project.read("sdd/areas/favorites.md")).toBe(AREA);
  });
});
