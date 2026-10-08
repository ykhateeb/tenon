import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { AREA, createFakeProject, RULES, type FakeProject } from "../testing/fake-project.js";
import { APPROVE, change, createFakeAgent, createFakePerson, STOP, testDeps, type AgentScript } from "../testing/fakes.js";
import { createRunner } from "./run-change.js";

const DIR = "sdd/changes/2026-10-08-sort";
const SPEC = `# Spec: Sort favorites
## Goal
Find recent favorites.

## User stories
### US1 — Sort by date (P1)
- [US1-S1] Given 3 favorites, When I sort by date, Then the newest is first

## Delta
### sdd/areas/favorites.md
- ADDED NEW-R1: Users can sort favorites by date
- MODIFIED FAV-R-002: List shows newest first
    (was: List shows in the order added)
`;
const PLAN = `# Plan: Sort favorites

## Tasks
### Phase 1 — US1 Sort by date (P1)
- [ ] T001 (test) [US1-S1] Test in tests/sort.txt
- [ ] T002 [NEW-R1, FAV-R-002] Sort in src/sort.txt
`;
const trace = (key: string, ids: readonly string[], evidence = "") => `# Traceability
| ID | Scenario | Level | Test | Status | Evidence | Verdict |
|---|---|---|---|---|---|---|
${ids.map((id) => `| ${id} | US1-S1 | Unit | tests/${key} |  | ${evidence} |  |`).join("\n")}
`;
const OUTCOME = "# Outcome\n\n## Delivered\n- US1\n\n## Evidence\n- all rows met\n\n## Changed after approval\n- none\n\n## Left open\n- none\n";
const BUG_SPEC = `# Spec: Order after sync
Area: favorites   Requirement: FAV-R-002

## User stories
### US1 — Order after sync (P1)
- [US1-S1] Given synced favorites, When I open the list, Then they show in the order added

## Delta
none
`;
const gatesOf = (asked: readonly string[]) => asked.map((question) => question.slice(0, 2));

/** The work of each stage of the full change "sort". */
function sortScript(project: FakeProject): AgentScript {
  return async (run) => {
    const dir = run.policy.changeDir;
    if (run.policy.kind === "spec") {
      project.write(`${dir}/spec.md`, SPEC);
      return { classification: { type: "feature", size: "full" } };
    }
    if (run.policy.kind === "plan") project.write(`${dir}/plan.md`, PLAN);
    if (run.policy.kind === "tests") {
      project.write("tests/sort.txt", "sort-us1-s1|src/sort.txt\n");
      project.write(`${dir}/traceability.md`, trace("sort-us1-s1", ["NEW-R1", "FAV-R-002"]));
      project.write(`${dir}/plan.md`, PLAN.replace("- [ ] T001", "- [x] T001"));
    }
    if (run.title.startsWith("sdd: build foundation")) {
      project.write("src/sort.txt", "sorted\n");
      project.write(`${dir}/plan.md`, PLAN.replaceAll("- [ ]", "- [x]"));
    }
    if (run.title.startsWith("sdd: build check")) project.write(`${dir}/traceability.md`, trace("sort-us1-s1", ["NEW-R1", "FAV-R-002"], "src/sort.txt"));
    if (run.policy.kind === "review") {
      project.write(`${dir}/outcome.md`, OUTCOME);
      return { findings: [] };
    }
    return undefined;
  };
}

/** The work of each stage of the small bug "fix". */
function fixScript(project: FakeProject): AgentScript {
  return async (run) => {
    const dir = run.policy.changeDir;
    if (run.policy.kind === "spec") {
      project.write(`${dir}/spec.md`, BUG_SPEC);
      return { classification: { type: "bug", size: "small" } };
    }
    if (run.policy.kind === "tests") {
      project.write("tests/fix.txt", "fix-us1-s1|src/fix.txt\n");
      project.write(`${dir}/traceability.md`, trace("fix-us1-s1", ["FAV-R-002"]));
    }
    if (run.policy.kind === "build") {
      project.write("src/fix.txt", "fixed\n");
      project.write(`${dir}/traceability.md`, trace("fix-us1-s1", ["FAV-R-002"], "src/fix.txt"));
    }
    if (run.policy.kind === "review") {
      project.write(`${dir}/outcome.md`, OUTCOME);
      return { findings: [] };
    }
    return undefined;
  };
}

function runner(project: FakeProject, script: AgentScript, answers: Parameters<typeof createFakePerson>[0]) {
  const fakeAgent = createFakeAgent(script);
  const fakePerson = createFakePerson(answers);
  return { ...fakeAgent, ...fakePerson, runner: createRunner(testDeps(project, fakeAgent.agent, fakePerson.person)) };
}

/** A project without rules. The setup session writes rules whose Full tier command leaves a marker file. */
function withoutRules() {
  const project = createFakeProject({ withRules: false });
  const marker = `${project.root}/reports/marker-setup-tier`;
  const rules = RULES.replace("Full tier: node fake-tests.mjs", `Full tier: mkdir -p ${project.root}/reports && touch ${marker} && node fake-tests.mjs`);
  const work = sortScript(project);
  const script: AgentScript = async (run, count) => {
    if (run.policy.kind !== "setup") return work(run, count);
    project.write("sdd/rules.md", rules);
  };
  return { project, marker, script };
}

const stateOf = (project: FakeProject, dir = DIR) => JSON.parse(project.read(`${dir}/state.json`)) as { stage: string; specVersion: number; reviewRounds: number; gates: { gate: string; result: string; reason?: string; commit?: string }[] };

describe("createRunner", () => {
  it("runs the full size from start to done", async () => {
    const project = createFakeProject();
    const { runner: sdd, runs, asked, notices } = runner(project, sortScript(project), { inputs: ["sort"], gates: [APPROVE, APPROVE, APPROVE] });
    await sdd.start("Sort favorites by date");
    expect(project.run("branch", "--show-current")).toBe("sdd/2026-10-08-sort");
    expect(runs.map((run) => run.title)).toEqual([
      "sdd: spec (sort)",
      "sdd: plan (sort)",
      "sdd: tests (sort)",
      "sdd: build foundation (sort)",
      "sdd: build US1 (sort)",
      "sdd: build check (sort)",
      "sdd: review (sort)",
    ]);
    expect(runs[0].message).toContain("Request: Sort favorites by date");
    expect(gatesOf(asked)).toEqual(["G1", "G2", "G3"]);
    expect(stateOf(project).stage).toBe("done");
    expect(stateOf(project).gates.map((gate) => `${gate.gate} ${gate.result}`)).toEqual(["G1 approved", "G2 approved", "G3 approved"]);
    const area = project.read("sdd/areas/favorites.md");
    expect(area).toContain("- FAV-R-005: Users can sort favorites by date  (since 2026-10-08-sort)");
    expect(area).toContain("- FAV-R-002: List shows newest first  (since 2026-10-08-sort; was: List shows in the order added)");
    expect(project.read(`${DIR}/outcome.md`)).toContain("- NEW-R1 → FAV-R-005");
    expect(project.run("log", "--format=%s")).toContain("sdd(sort): G1 approved");
    expect(project.run("status", "--porcelain")).toBe("");
    expect(notices.at(-1)).toBe("The change is ready. Merge the branch sdd/2026-10-08-sort into main.");
    const diffPath = /Diff of the change: (.+)/.exec(runs[6].message)?.[1] ?? "";
    expect(diffPath).toMatch(/\.diff$/);
    expect(existsSync(dirname(diffPath))).toBe(false);
  });

  it("runs the small size: no Plan, and only G3", async () => {
    const project = createFakeProject();
    const { runner: sdd, runs, asked } = runner(project, fixScript(project), { inputs: ["fix"], gates: [APPROVE] });
    await sdd.start("Fix the order after sync");
    expect(runs.map((run) => run.title)).toEqual(["sdd: spec (fix)", "sdd: tests (fix)", "sdd: build (fix)", "sdd: review (fix)"]);
    expect(gatesOf(asked)).toEqual(["G3"]);
    const area = project.read("sdd/areas/favorites.md");
    expect(area).toContain("- FAV-R-002 → fix-us1-s1");
    expect(area).toContain("- 2026-10-08-fix: tests for FAV-R-002");
  });

  it("starts a new stage session with the feedback of the person at a gate", async () => {
    const project = createFakeProject();
    const { runner: sdd, runs } = runner(project, sortScript(project), { inputs: ["sort"], gates: [change("Add an edge case."), APPROVE, APPROVE, APPROVE] });
    await sdd.start("Sort favorites by date");
    expect(runs[1].title).toBe("sdd: spec change (sort)");
    expect(runs[1].message).toContain("The person asked for this change at G1: Add an edge case.");
    expect(stateOf(project).stage).toBe("done");
  });

  it("advances without G1 when the person's change at G1 makes the change small", async () => {
    const project = createFakeProject();
    const work = sortScript(project);
    const script: AgentScript = async (run, count) => {
      if (run.title === "sdd: build (sort)") {
        project.write("src/sort.txt", "sorted\n");
        project.write(`${run.policy.changeDir}/traceability.md`, trace("sort-us1-s1", ["FAV-R-002"], "src/sort.txt"));
      }
      if (run.title !== "sdd: spec change (sort)") return work(run, count);
      project.write(`${run.policy.changeDir}/spec.md`, BUG_SPEC);
      return { classification: { type: "bug", size: "small" } };
    };
    const { runner: sdd, runs, asked } = runner(project, script, { inputs: ["sort"], gates: [change("It is only a bug."), STOP] });
    await sdd.start("Sort favorites by date");
    expect(gatesOf(asked)).toEqual(["G1", "G3"]);
    expect(runs[2].title).toBe("sdd: tests (sort)");
  });

  it("refuses to start when the committed rules do not parse", async () => {
    const project = createFakeProject();
    project.write("sdd/rules.md", "# Project Rules\n");
    project.run("commit", "-qam", "break the rules");
    const { runner: sdd, runs, notices } = runner(project, sortScript(project), { inputs: ["sort"] });
    await sdd.start("Sort favorites by date");
    expect(notices[0]).toMatch(/^Correct sdd\/rules.md first\. It does not parse: /);
    expect(project.run("branch", "--list", "sdd/*")).toBe("");
    expect(runs).toEqual([]);
  });

  it("returns from Build to Tests and asks G2 again", async () => {
    const project = createFakeProject();
    const work = sortScript(project);
    let hasReturned = false;
    const script: AgentScript = async (run, count) => {
      if (run.title === "sdd: build foundation (sort)" && !hasReturned) {
        hasReturned = true;
        return { returnRequest: { stage: "tests", reason: "weak test" } };
      }
      return work(run, count);
    };
    const { runner: sdd, asked } = runner(project, script, { inputs: ["sort"], gates: [APPROVE, APPROVE, APPROVE, APPROVE] });
    await sdd.start("Sort favorites by date");
    expect(gatesOf(asked)).toEqual(["G1", "G2", "G2", "G3"]);
    expect(stateOf(project).gates).toContainEqual(expect.objectContaining({ gate: "G2", result: "reopened", reason: "weak test" }));
    expect(stateOf(project).stage).toBe("done");
  });

  it("returns to Tests after Build for a review finding, accepts the passing tests, and asks G2 again", async () => {
    const project = createFakeProject();
    const work = sortScript(project);
    let hasFound = false;
    const script: AgentScript = async (run, count) => {
      const result = await work(run, count);
      if (run.policy.kind !== "review" || hasFound) return result;
      hasFound = true;
      return { ...result, findings: [{ file: "tests/sort.txt", problem: "checks nothing", action: "assert the order", returnTo: "tests" as const }] };
    };
    const { runner: sdd, asked } = runner(project, script, { inputs: ["sort"], gates: [APPROVE, APPROVE, APPROVE, APPROVE] });
    await sdd.start("Sort favorites by date");
    expect(gatesOf(asked)).toEqual(["G1", "G2", "G2", "G3"]);
    expect(stateOf(project).stage).toBe("done");
  });

  it("restores an area spec that the agent wrote through bash, and tells the agent", async () => {
    const project = createFakeProject();
    const work = sortScript(project);
    const script: AgentScript = async (run, count) => {
      if (run.title === "sdd: build foundation (sort)") project.write("sdd/areas/favorites.md", "broken\n");
      return work(run, count);
    };
    const { runner: sdd, followUps } = runner(project, script, { inputs: ["sort"], gates: [APPROVE, APPROVE, APPROVE] });
    await sdd.start("Sort favorites by date");
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toContain("sdd/areas/favorites.md");
    expect(project.read("sdd/areas/favorites.md")).toContain("FAV-R-005");
  });

  it("restores an approved test that the agent changed in Build", async () => {
    const project = createFakeProject();
    const work = sortScript(project);
    const script: AgentScript = async (run, count) => {
      const result = await work(run, count);
      if (run.title === "sdd: build foundation (sort)") project.write("tests/sort.txt", "sort-us1-s1|src/other.txt\n");
      return result;
    };
    const { runner: sdd, followUps } = runner(project, script, { inputs: ["sort"], gates: [APPROVE, APPROVE, APPROVE] });
    await sdd.start("Sort favorites by date");
    expect(followUps[0]).toContain("tests/sort.txt");
    expect(project.read("tests/sort.txt")).toBe("sort-us1-s1|src/sort.txt\n");
  });

  it("returns to Spec when the base changed a MODIFIED requirement before Ship", async () => {
    const project = createFakeProject();
    const work = sortScript(project);
    const script: AgentScript = async (run, count) => {
      if (run.title === "sdd: build check (sort)") {
        const worktree = mkdtempSync(join(tmpdir(), "tenon-sdd-main-"));
        project.run("worktree", "add", "-q", worktree, "main");
        writeFileSync(join(worktree, "sdd/areas/favorites.md"), AREA.replace("List shows in the order added", "List shows in alphabetical order"));
        execFileSync("git", ["-C", worktree, "commit", "-qam", "change FAV-R-002 on main"]);
      }
      if (run.policy.kind === "spec" && count > 1) {
        project.write(`${run.policy.changeDir}/spec.md`, SPEC.replace("(was: List shows in the order added)", "(was: List shows in alphabetical order)"));
        return { classification: { type: "feature", size: "full" } };
      }
      return work(run, count);
    };
    const { runner: sdd, asked } = runner(project, script, { inputs: ["sort"], gates: [APPROVE, APPROVE, STOP] });
    await sdd.start("Sort favorites by date");
    expect(gatesOf(asked)).toEqual(["G1", "G2", "G1"]);
    const state = stateOf(project);
    expect(state.stage).toBe("spec");
    expect(state.specVersion).toBe(2);
    expect(state.gates).toContainEqual(expect.objectContaining({ gate: "G1", result: "reopened" }));
  });

  it("stops on a merge conflict with the base, refuses to resume during the merge, and continues after the person commits", async () => {
    const project = createFakeProject();
    const work = sortScript(project);
    const script: AgentScript = async (run, count) => {
      if (run.title === "sdd: build check (sort)") {
        const worktree = mkdtempSync(join(tmpdir(), "tenon-sdd-main-"));
        project.run("worktree", "add", "-q", worktree, "main");
        writeFileSync(join(worktree, "src/sort.txt"), "main version\n");
        execFileSync("git", ["-C", worktree, "add", "-A"]);
        execFileSync("git", ["-C", worktree, "commit", "-qm", "sort on main"]);
      }
      return work(run, count);
    };
    const first = runner(project, script, { inputs: ["sort"], gates: [APPROVE, APPROVE] });
    await first.runner.start("Sort favorites by date");
    expect(first.notices.at(-1)).toMatch(/^Merging main into this branch failed\. Resolve the conflicts, commit, and run \/sdd again\./);
    expect(gatesOf(first.asked)).toEqual(["G1", "G2"]);
    const second = runner(project, script, {});
    await second.runner.resume();
    expect(second.notices).toEqual(["Finish the merge first: resolve the conflicts and commit. Then run /sdd again."]);
    expect(second.runs).toEqual([]);
    project.run("checkout", "-q", "--ours", "src/sort.txt");
    project.run("add", "src/sort.txt");
    project.run("commit", "-q", "--no-edit");
    const third = runner(project, script, { gates: [APPROVE] });
    await third.runner.resume();
    expect(gatesOf(third.asked)).toEqual(["G3"]);
    expect(project.read("src/sort.txt")).toBe("sorted\n");
    expect(stateOf(project).stage).toBe("done");
  });

  it("continues at the gate where it stopped", async () => {
    const project = createFakeProject();
    const first = runner(project, sortScript(project), { inputs: ["sort"], gates: [APPROVE, STOP] });
    await first.runner.start("Sort favorites by date");
    expect(gatesOf(first.asked)).toEqual(["G1", "G2"]);
    const second = runner(project, sortScript(project), { gates: [APPROVE, APPROVE] });
    await second.runner.resume();
    expect(gatesOf(second.asked)).toEqual(["G2", "G3"]);
    expect(second.runs[0].title).toBe("sdd: build foundation (sort)");
    expect(stateOf(project).stage).toBe("done");
  });

  it("asks only G3 on resume after Build added a test file", async () => {
    const project = createFakeProject();
    const work = sortScript(project);
    const script: AgentScript = async (run, count) => {
      if (run.title === "sdd: build foundation (sort)") project.write("tests/unit.txt", "sort-unit|src/sort.txt\n");
      return work(run, count);
    };
    const first = runner(project, script, { inputs: ["sort"], gates: [APPROVE, APPROVE, STOP] });
    await first.runner.start("Sort favorites by date");
    const second = runner(project, script, { gates: [APPROVE] });
    await second.runner.resume();
    expect(gatesOf(second.asked)).toEqual(["G3"]);
    expect(stateOf(project).stage).toBe("done");
  });

  it("does nothing when the person closes the slug dialog", async () => {
    const project = createFakeProject();
    const { runner: sdd, runs } = runner(project, sortScript(project), { inputs: [undefined] });
    await sdd.start("Sort favorites by date");
    expect(project.run("branch", "--list", "sdd/*")).toBe("");
    expect(project.run("status", "--porcelain")).toBe("");
    expect(runs).toEqual([]);
  });

  it("refuses to start with uncommitted work", async () => {
    const project = createFakeProject();
    project.write("src/draft.txt", "draft\n");
    const { runner: sdd, notices } = runner(project, sortScript(project), { inputs: ["sort"] });
    await sdd.start("Sort favorites by date");
    expect(notices).toEqual(["Commit or stash your work first. /sdd needs a clean working tree."]);
  });

  it("refuses to start on a detached HEAD", async () => {
    const project = createFakeProject();
    project.run("checkout", "-q", "--detach");
    const { runner: sdd, runs, notices } = runner(project, sortScript(project), { inputs: ["sort"] });
    await sdd.start("Sort favorites by date");
    expect(notices).toEqual(["Switch to a branch first. /sdd does not run on a detached HEAD."]);
    expect(runs).toEqual([]);
  });

  it("restores a protected file that changes while the person reads a gate, and asks the gate again", async () => {
    const project = createFakeProject();
    const { runner: sdd, person, asked, notices } = runner(project, sortScript(project), { inputs: ["sort"], gates: [APPROVE, APPROVE, APPROVE, APPROVE] });
    const ask = person.gate;
    let isFirst = true;
    person.gate = async (question, summary) => {
      if (question.startsWith("G1") && isFirst) {
        isFirst = false;
        project.write("sdd/areas/favorites.md", "broken\n");
      }
      return ask.call(person, question, summary);
    };
    await sdd.start("Sort favorites by date");
    expect(gatesOf(asked)).toEqual(["G1", "G1", "G2", "G3"]);
    expect(notices).toContain("Files changed after the summary. Review the gate again.");
    const approval = stateOf(project).gates.find((gate) => gate.gate === "G1" && gate.result === "approved");
    expect(project.run("show", `${approval?.commit}:sdd/areas/favorites.md`)).toBe(AREA.trim());
    expect(stateOf(project).stage).toBe("done");
  });

  it("throws and records no approval when the person switches the branch at a gate", async () => {
    const project = createFakeProject();
    const { runner: sdd, person, runs } = runner(project, sortScript(project), { inputs: ["sort"], gates: [APPROVE] });
    const ask = person.gate;
    person.gate = async (question, summary) => {
      project.run("switch", "-q", "-c", "other");
      return ask.call(person, question, summary);
    };
    await expect(sdd.start("Sort favorites by date")).rejects.toThrow('The branch changed to "other". Switch back to sdd/2026-10-08-sort and run /sdd again.');
    expect(project.run("log", "--format=%s", "sdd/2026-10-08-sort")).not.toContain("G1 approved");
    expect(project.run("log", "--all", "--format=%s")).not.toContain("G1 approved");
    expect(runs).toHaveLength(1);
  });

  it("protects the files of an interrupted session on resume, before the pre-check commit", async () => {
    const project = createFakeProject();
    const first = runner(project, sortScript(project), { inputs: ["sort"], gates: [APPROVE, STOP] });
    await first.runner.start("Sort favorites by date");
    project.write("sdd/areas/favorites.md", "broken\n");
    const second = runner(project, sortScript(project), { gates: [APPROVE, APPROVE] });
    await second.runner.resume();
    expect(second.runs[0].title).toBe("sdd: tests (sort)");
    expect(second.runs[0].message).toContain("sdd/areas/favorites.md");
    expect(second.notices.join("\n")).toContain("sdd/areas/favorites.md");
    expect(project.run("show", `${stateOf(project).gates.find((gate) => gate.gate === "G2")?.commit}:sdd/areas/favorites.md`)).toBe(AREA.trim());
    expect(stateOf(project).stage).toBe("done");
  });

  it("reads the state of the last commit on resume, not the file of the working tree", async () => {
    const project = createFakeProject();
    const first = runner(project, sortScript(project), { inputs: ["sort"], gates: [APPROVE, STOP] });
    await first.runner.start("Sort favorites by date");
    project.write(`${DIR}/state.json`, '{"stage":"done"}');
    const second = runner(project, sortScript(project), { gates: [APPROVE, APPROVE] });
    await second.runner.resume();
    expect(gatesOf(second.asked)[0]).toBe("G2");
    expect(stateOf(project).stage).toBe("done");
  });

  it("resumes at the pending G3 without a new review session", async () => {
    const project = createFakeProject();
    const first = runner(project, sortScript(project), { inputs: ["sort"], gates: [APPROVE, APPROVE, STOP] });
    await first.runner.start("Sort favorites by date");
    expect(stateOf(project).stage).toBe("ship");
    const second = runner(project, sortScript(project), { gates: [APPROVE] });
    await second.runner.resume();
    expect(second.runs).toEqual([]);
    expect(gatesOf(second.asked)).toEqual(["G3"]);
    expect(stateOf(project).stage).toBe("done");
  });

  it("restores a protected file of an interrupted Ship before any commit, and tells the person", async () => {
    const project = createFakeProject();
    const first = runner(project, sortScript(project), { inputs: ["sort"], gates: [APPROVE, APPROVE, STOP] });
    await first.runner.start("Sort favorites by date");
    project.write("tests/sort.txt", "sort-us1-s1|src/other.txt\n");
    const second = runner(project, sortScript(project), { gates: [APPROVE] });
    await second.runner.resume();
    expect(second.notices.join("\n")).toContain("tests/sort.txt");
    expect(project.read("tests/sort.txt")).toBe("sort-us1-s1|src/sort.txt\n");
    expect(project.run("log", "--format=%s")).not.toContain("sdd(sort): resume");
  });

  it("returns to Build for review findings two times, then asks G3", async () => {
    const project = createFakeProject();
    const work = sortScript(project);
    const script: AgentScript = async (run, count) => {
      const result = await work(run, count);
      return run.policy.kind === "review" ? { ...result, findings: [{ file: "src/sort.txt", problem: "x", action: "y", returnTo: "build" as const }] } : result;
    };
    const { runner: sdd, runs, asked } = runner(project, script, { inputs: ["sort"], gates: [APPROVE, APPROVE, APPROVE] });
    await sdd.start("Sort favorites by date");
    expect(runs.filter((run) => run.title === "sdd: build foundation (sort)")).toHaveLength(3);
    expect(runs.filter((run) => run.title === "sdd: review (sort)")).toHaveLength(3);
    expect(gatesOf(asked)).toEqual(["G1", "G2", "G3"]);
    expect(stateOf(project).reviewRounds).toBe(2);
    expect(stateOf(project).stage).toBe("done");
  });

  it("gives the return reason to the next Build session after a review finding", async () => {
    const project = createFakeProject();
    const work = sortScript(project);
    let hasFound = false;
    const script: AgentScript = async (run, count) => {
      const result = await work(run, count);
      if (run.policy.kind !== "review" || hasFound) return result;
      hasFound = true;
      return { ...result, findings: [{ file: "src/sort.txt", problem: "the sort is not stable", action: "keep the order of equal dates", returnTo: "build" as const }] };
    };
    const { runner: sdd, runs } = runner(project, script, { inputs: ["sort"], gates: [APPROVE, APPROVE, APPROVE] });
    await sdd.start("Sort favorites by date");
    const builds = runs.filter((run) => run.title === "sdd: build foundation (sort)");
    expect(builds[0].message).not.toContain("Returned to this stage");
    expect(builds[1].message).toContain("Returned to this stage: Review findings: src/sort.txt: the sort is not stable");
    expect(runs.at(-1)?.message).not.toContain("Returned to this stage");
    expect(stateOf(project).stage).toBe("done");
  });

  it("keeps the return reason when the person stops the returned Build session, and gives it on resume", async () => {
    const project = createFakeProject();
    const work = sortScript(project);
    let hasFound = false;
    let hasStopped = false;
    const script: AgentScript = async (run, count) => {
      if (hasFound && !hasStopped && run.policy.kind === "build") {
        hasStopped = true;
        return { aborted: true };
      }
      const result = await work(run, count);
      if (run.policy.kind !== "review" || hasFound) return result;
      hasFound = true;
      return { ...result, findings: [{ file: "src/sort.txt", problem: "the sort is not stable", action: "keep the order of equal dates", returnTo: "build" as const }] };
    };
    const first = runner(project, script, { inputs: ["sort"], gates: [APPROVE, APPROVE] });
    await first.runner.start("Sort favorites by date");
    expect(stateOf(project).stage).toBe("build");
    const second = runner(project, script, { gates: [APPROVE] });
    await second.runner.resume();
    expect(second.runs[0]?.title).toBe("sdd: build (sort)");
    expect(second.runs[0]?.message).toContain("Returned to this stage: Review findings: src/sort.txt: the sort is not stable");
    expect(stateOf(project).stage).toBe("done");
  });

  it("restarts the current stage when an agent asks to return to a later stage", async () => {
    const project = createFakeProject();
    const work = sortScript(project);
    let hasReturned = false;
    const script: AgentScript = async (run, count) => {
      if (run.policy.kind === "tests" && !hasReturned) {
        hasReturned = true;
        return { returnRequest: { stage: "build", reason: "x" } };
      }
      return work(run, count);
    };
    const { runner: sdd, runs, asked } = runner(project, script, { inputs: ["sort"], gates: [APPROVE, STOP] });
    await sdd.start("Sort favorites by date");
    expect(runs.map((run) => run.title)).toEqual(["sdd: spec (sort)", "sdd: plan (sort)", "sdd: tests (sort)", "sdd: tests (sort)"]);
    expect(runs[3].message).toContain("Returned to this stage: x");
    expect(gatesOf(asked)).toEqual(["G1", "G2"]);
  });

  it("starts a small change again at Spec when Build makes it full, and asks G1", async () => {
    const project = createFakeProject();
    const work = fixScript(project);
    let hasReturned = false;
    const script: AgentScript = async (run, count) => {
      if (run.policy.kind === "build" && !hasReturned) {
        hasReturned = true;
        return { returnRequest: { stage: "build", reason: "it needs a new screen", size: "full" } };
      }
      const result = await work(run, count);
      return run.policy.kind === "spec" && hasReturned ? { classification: { type: "bug", size: "full" } } : result;
    };
    const { runner: sdd, runs, asked } = runner(project, script, { inputs: ["fix"], gates: [STOP] });
    await sdd.start("Fix the order after sync");
    expect(runs.map((run) => run.title)).toEqual(["sdd: spec (fix)", "sdd: tests (fix)", "sdd: build (fix)", "sdd: spec (fix)"]);
    expect(runs[3].message).toContain("Returned to this stage: it needs a new screen");
    expect(gatesOf(asked)).toEqual(["G1"]);
    expect(project.run("log", "--format=%s")).toContain("sdd(fix): return to spec");
  });

  it("locks the approved tests with the rules of the last commit, not the rules of the working tree", async () => {
    const project = createFakeProject();
    const first = runner(project, sortScript(project), { inputs: ["sort"], gates: [APPROVE, APPROVE, STOP] });
    await first.runner.start("Sort favorites by date");
    project.write("sdd/rules.md", RULES.replace("Test files: tests/**", "Test files: docs/**"));
    project.write("tests/sort.txt", "sort-us1-s1|src/other.txt\n");
    const second = runner(project, sortScript(project), { gates: [APPROVE] });
    await second.runner.resume();
    expect(second.notices.join("\n")).toContain("tests/sort.txt");
    expect(project.read("tests/sort.txt")).toBe("sort-us1-s1|src/sort.txt\n");
    expect(project.run("log", "--format=%s", "--", "tests/sort.txt")).not.toContain("resume");
    expect(project.read("sdd/rules.md")).toBe(RULES);
    expect(stateOf(project).stage).toBe("done");
  });

  it("does not treat a stopped rules draft as approved on resume", async () => {
    const { project, marker, script } = withoutRules();
    const first = runner(project, script, { inputs: ["sort"], gates: [STOP] });
    await first.runner.start("Sort favorites by date");
    expect(existsSync(marker)).toBe(false);
    const second = runner(project, script, { gates: [STOP] });
    await second.runner.resume();
    expect(second.asked).toEqual(["Approve sdd/rules.md?"]);
    expect(existsSync(marker)).toBe(false);
  });

  it("replaces the stopped rules draft with one approval commit when the person approves on resume", async () => {
    const { project, marker, script } = withoutRules();
    const first = runner(project, script, { inputs: ["sort"], gates: [STOP] });
    await first.runner.start("Sort favorites by date");
    const second = runner(project, script, { gates: [APPROVE, APPROVE, APPROVE, APPROVE] });
    await second.runner.resume();
    expect(second.asked[0]).toBe("Approve sdd/rules.md?");
    expect(project.run("log", "-1", "--format=%s", "--", "sdd/rules.md")).toBe("sdd(sort): rules approved");
    expect(project.run("log", "--format=%s")).not.toContain("rules draft");
    expect(existsSync(marker)).toBe(true);
    expect(stateOf(project).stage).toBe("done");
  });
});
