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
  it("records a valid approval at the reviewed HEAD", async () => {
    const { project, deps, change } = await started();
    project.write(`${change.dir}/spec.md`, "# Spec: Sort\n");
    const reviewedHead = (await project.git.commitAll("sdd(sort): spec done"))!;
    const approved = await recordApproval(deps, change, "G1", await readState(change), reviewedHead);
    expect(approved).toBeDefined();
    expect(approved!.gates).toEqual([{ gate: "G1", result: "approved", commit: reviewedHead, by: "Sam", at: "2026-10-08" }]);
    expect(project.run("log", "-1", "--format=%s")).toBe("sdd(sort): G1 approved");
    expect(project.run("status", "--porcelain")).toBe("");
  });

  it("refuses approval when a file changes after reviewedHead", async () => {
    const { project, deps, change } = await started();
    project.write(`${change.dir}/spec.md`, "# Spec: Sort\n");
    const reviewedHead = (await project.git.commitAll("sdd(sort): spec done"))!;
    project.write(`${change.dir}/spec.md`, "# Spec: Sort v2\n");
    const approved = await recordApproval(deps, change, "G1", await readState(change), reviewedHead);
    expect(approved).toBeUndefined();
  });

  it("refuses approval when HEAD moved", async () => {
    const { project, deps, change } = await started();
    project.write(`${change.dir}/spec.md`, "# Spec: Sort\n");
    const reviewedHead = (await project.git.commitAll("sdd(sort): spec done"))!;
    project.write("other.txt", "content\n");
    await project.git.commitAll("other change");
    const approved = await recordApproval(deps, change, "G1", await readState(change), reviewedHead);
    expect(approved).toBeUndefined();
  });

  it("refuses approval on another branch at the same commit", async () => {
    const { project, deps, change } = await started();
    project.write(`${change.dir}/spec.md`, "# Spec: Sort\n");
    const reviewedHead = (await project.git.commitAll("sdd(sort): spec done"))!;
    project.run("switch", "-q", "-c", "other");
    const approved = await recordApproval(deps, change, "G1", await readState(change), reviewedHead);
    expect(approved).toBeUndefined();
    expect(project.run("log", "-1", "--format=%s")).toBe("sdd(sort): spec done");
  });
});

describe("invalidGates and lockedTests", () => {
  it("find a gate whose covered file changed, and the approved tests", async () => {
    const { project, deps, change, rules } = await started();
    project.write(`${change.dir}/spec.md`, "# Spec: Sort\n");
    let reviewed = (await project.git.commitAll("sdd(sort): spec done"))!;
    let state = (await recordApproval(deps, change, "G1", await readState(change), reviewed))!;
    project.write("tests/sort.txt", "sort-us1-s1|src/sort.txt\n");
    reviewed = (await project.git.commitAll("sdd(sort): tests done"))!;
    state = (await recordApproval(deps, change, "G2", state, reviewed))!;
    expect(await lockedTests(deps, state, rules)).toEqual(["tests/sort.txt"]);
    expect(await invalidGates(deps, change, state, rules)).toEqual([]);
    project.write(`${change.dir}/spec.md`, "# Spec: Sort, changed\n");
    expect(await invalidGates(deps, change, state, rules)).toEqual(["G1", "G2"]);
  });

  it("does not reopen G2 for a new test file after the approval", async () => {
    const { project, deps, change, rules } = await started();
    project.write(`${change.dir}/spec.md`, "# Spec: Sort\n");
    let reviewed = (await project.git.commitAll("sdd(sort): spec done"))!;
    let state = (await recordApproval(deps, change, "G1", await readState(change), reviewed))!;
    project.write("tests/sort.txt", "sort-us1-s1|src/sort.txt\n");
    reviewed = (await project.git.commitAll("sdd(sort): tests done"))!;
    state = (await recordApproval(deps, change, "G2", state, reviewed))!;
    project.write("tests/new.txt", "new-us1-s1|src/new.txt\n");
    await project.git.commitAll("new test");
    expect(await invalidGates(deps, change, state, rules)).toEqual([]);
  });

  it("detects new files after G3 approval", async () => {
    const { project, deps, change, rules } = await started();
    project.write(`${change.dir}/spec.md`, "# Spec: Sort\n");
    let reviewed = (await project.git.commitAll("sdd(sort): spec done"))!;
    let state = (await recordApproval(deps, change, "G1", await readState(change), reviewed))!;
    project.write("tests/sort.txt", "sort-us1-s1|src/sort.txt\n");
    reviewed = (await project.git.commitAll("sdd(sort): tests done"))!;
    state = (await recordApproval(deps, change, "G2", state, reviewed))!;
    project.write("src/new.ts", "export const x = 1;\n");
    reviewed = (await project.git.commitAll("sdd(sort): impl done"))!;
    state = (await recordApproval(deps, change, "G3", state, reviewed))!;
    project.write("src/extra.ts", "export const y = 2;\n");
    await project.git.commitAll("extra file");
    expect(await invalidGates(deps, change, state, rules)).toEqual(["G3"]);
  });
});

describe("gateSummary", () => {
  it("shows the outcome, the area spec diff, and the file list at G3", async () => {
    const { project, deps, change, rules } = await started();
    project.write(`${change.dir}/outcome.md`, "# Outcome: sort\n\n## Delivered\n- US1\n");
    project.write("sdd/areas/favorites.md", project.read("sdd/areas/favorites.md").replace("Max 100 favorites", "Max 500 favorites"));
    project.write("src/sort.txt", "sorted\n");
    await project.git.commitAll("sdd(sort): build passed");
    const summary = await gateSummary(deps, change, "G3", await readState(change), rules);
    expect(summary).toContain("**Is the final diff, the area specs included, correct and good code to keep?**");
    expect(summary).toContain("## Delivered");
    expect(summary).toMatch(/### Area spec changes\n\n```diff\n[\s\S]*\+- FAV-R-003: Max 500 favorites/);
    expect(summary).toMatch(/### Files\n\n```\n[\s\S]*src\/sort.txt/);
    expect(summary).not.toContain("### sdd/changes/2026-10-08-sort/spec.md");
  });

  it("shows the question and the spec at G1", async () => {
    const { project, deps, change, rules } = await started();
    project.write(`${change.dir}/spec.md`, "# Spec: Sort\n");
    const summary = await gateSummary(deps, change, "G1", await readState(change), rules);
    expect(summary).toContain("**Is this the right thing to build?**");
    expect(summary).toContain("# Spec: Sort");
  });
});
