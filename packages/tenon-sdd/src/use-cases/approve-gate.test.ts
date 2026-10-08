import { describe, expect, it } from "vitest";
import { createFakeProject } from "../testing/fake-project.js";
import { createFakeAgent, createFakePerson, testDeps } from "../testing/fakes.js";
import { readRules, readState } from "./change.js";
import { gateSummary, invalidGates, lockedTests, recordApproval } from "./approve-gate.js";
import { startChange } from "./start-change.js";

async function started() {
  const project = createFakeProject();
  const deps = testDeps(project, createFakeAgent(async () => {}).agent, createFakePerson({}).person);
  const change = await startChange(deps, { request: "Sort", slug: "sort" });
  return { project, deps, change, rules: await readRules(project.root) };
}

describe("recordApproval", () => {
  it("commits the work, records that commit, and commits state.json", async () => {
    const { project, deps, change } = await started();
    project.write(`${change.dir}/spec.md`, "# Spec: Sort\n");
    const approved = await recordApproval(deps, change, "G1", await readState(change));
    expect(approved.gates).toEqual([{ gate: "G1", result: "approved", commit: project.run("rev-parse", "HEAD~1"), by: "Sam", at: "2026-10-08" }]);
    expect(project.run("log", "-2", "--format=%s")).toBe("sdd(sort): record G1\nsdd(sort): G1 approved");
    expect(project.run("status", "--porcelain")).toBe("");
  });
});

describe("invalidGates and lockedTests", () => {
  it("find a gate whose covered file changed, and the approved tests", async () => {
    const { project, deps, change, rules } = await started();
    project.write(`${change.dir}/spec.md`, "# Spec: Sort\n");
    let state = await recordApproval(deps, change, "G1", await readState(change));
    project.write("tests/sort.txt", "sort-us1-s1|src/sort.txt\n");
    state = await recordApproval(deps, change, "G2", state);
    expect(await lockedTests(deps, state, rules)).toEqual(["tests/sort.txt"]);
    expect(await invalidGates(deps, change, state, rules)).toEqual([]);
    project.write(`${change.dir}/spec.md`, "# Spec: Sort, changed\n");
    expect(await invalidGates(deps, change, state, rules)).toEqual(["G1", "G2"]);
  });
});

describe("gateSummary", () => {
  it("shows the question and the spec at G1", async () => {
    const { project, deps, change, rules } = await started();
    project.write(`${change.dir}/spec.md`, "# Spec: Sort\n");
    const summary = await gateSummary(deps, change, "G1", await readState(change), rules);
    expect(summary).toContain("**Is this the right thing to build?**");
    expect(summary).toContain("# Spec: Sort");
  });
});
