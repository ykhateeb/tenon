import { describe, expect, it } from "vitest";
import type { Policy } from "../entities/write-policy.js";
import { AREA, createFakeProject } from "../testing/fake-project.js";
import { createFakeAgent, createFakePerson, testDeps, type AgentScript } from "../testing/fakes.js";
import { readState, stateText } from "./change.js";
import type { StageRun } from "./ports.js";
import { protectedErrors, runChecked } from "./run-stage.js";
import { startChange } from "./start-change.js";

const POLICY: Policy = { kind: "spec", changeDir: "sdd/changes/2026-10-08-sort", specLocked: false, lockedTests: [], testGlobs: [] };
const RUN: StageRun = { title: "sdd: spec (sort)", message: "Read the guide.", policy: POLICY };
const none = async () => [];
const nothing = async () => {};

function deps(agentScript: AgentScript = async () => {}, answers: { choices?: (string | undefined)[] } = {}) {
  const project = createFakeProject();
  const fakeAgent = createFakeAgent(agentScript);
  const fakePerson = createFakePerson(answers);
  return { project, ...fakeAgent, deps: testDeps(project, fakeAgent.agent, fakePerson.person) };
}

describe("runChecked", () => {
  it("passes when the check passes", async () => {
    const { deps: d, followUps } = deps();
    expect(await runChecked(d, { runs: [RUN], protect: none, apply: nothing, check: none })).toEqual({ kind: "passed" });
    expect(followUps).toEqual([]);
  });

  it("sends the errors back to the session until the check passes", async () => {
    const { deps: d, followUps } = deps();
    const results = [["Fix the scenario."], []];
    expect(await runChecked(d, { runs: [RUN], protect: none, apply: nothing, check: async () => results.shift() ?? [] })).toEqual({ kind: "passed" });
    expect(followUps).toEqual(["The exit check of this stage failed. Correct these items, then stop:\n- Fix the scenario."]);
  });

  it("asks the person after 3 failed checks, and stops when the person says Stop", async () => {
    const { deps: d, followUps } = deps(async () => {}, { choices: ["Stop"] });
    expect(await runChecked(d, { runs: [RUN], protect: none, apply: nothing, check: async () => ["Still wrong."] })).toEqual({ kind: "stopped" });
    expect(followUps).toHaveLength(2);
  });

  it("stops when the person stops the agent, and returns on a return request", async () => {
    const stopped = deps(async () => ({ aborted: true }));
    expect(await runChecked(stopped.deps, { runs: [RUN], protect: none, apply: nothing, check: none })).toEqual({ kind: "stopped" });
    const returned = deps(async () => ({ returnRequest: { stage: "spec" as const, reason: "The spec is wrong." } }));
    expect(await runChecked(returned.deps, { runs: [RUN], protect: none, apply: nothing, check: none })).toEqual({ kind: "returned", request: { stage: "spec", reason: "The spec is wrong." } });
  });

  it("applies each outcome before the check", async () => {
    const { deps: d } = deps(async () => ({ classification: { type: "bug" as const, size: "small" as const } }));
    const applied: unknown[] = [];
    await runChecked(d, { runs: [RUN], protect: none, apply: async (outcome) => void applied.push(outcome.classification), check: none });
    expect(applied).toEqual([{ type: "bug", size: "small" }]);
  });
});

describe("protectedErrors", () => {
  it("restores protected files and state.json, and tells the agent", async () => {
    const { project, deps: d } = deps();
    const change = await startChange(d, { request: "Sort", slug: "sort" });
    const state = await readState(change);
    const since = await d.git.head();
    project.write("sdd/areas/favorites.md", "broken\n");
    project.write("sdd/changes/2026-09-01-old/spec.md", "new file in another change\n");
    project.write(`${change.dir}/state.json`, "{}\n");
    const errors = await protectedErrors(d, change, POLICY, state, since);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/sdd\/areas\/favorites.md, sdd\/changes\/2026-09-01-old\/spec.md/);
    expect(project.read("sdd/areas/favorites.md")).toBe(AREA);
    expect(project.read(`${change.dir}/state.json`)).toBe(stateText(state));
    expect(await protectedErrors(d, change, POLICY, state, since)).toEqual([]);
  });

  it("undoes committed changes and restores files", async () => {
    const { project, deps: d } = deps();
    const change = await startChange(d, { request: "Sort", slug: "sort" });
    const state = await readState(change);
    const since = await d.git.head();
    project.write("sdd/areas/favorites.md", "edited\n");
    project.run("commit", "-qam", "agent edit");
    const errors = await protectedErrors(d, change, POLICY, state, since);
    expect(errors[0]).toContain("Do not run git commit");
    expect(await d.git.head()).toBe(since);
    expect(project.read("sdd/areas/favorites.md")).toBe(AREA);
  });

  it("protects against protected file changes on early exit", async () => {
    const { project, deps: d } = deps(async () => {
      project.write("sdd/areas/favorites.md", "broken\n");
      return { returnRequest: { stage: "spec" as const, reason: "wrong" } };
    });
    const change = await startChange(d, { request: "Sort", slug: "sort" });
    const state = await readState(change);
    const since = await d.git.head();
    const realProtect = async () => protectedErrors(d, change, POLICY, state, since);
    await runChecked(d, { runs: [RUN], protect: realProtect, apply: async () => {}, check: async () => [] });
    expect(project.read("sdd/areas/favorites.md")).toBe(AREA);
  });

  it("rejects when the agent switches the branch", async () => {
    const { project, deps: d } = deps();
    const change = await startChange(d, { request: "Sort", slug: "sort" });
    const state = await readState(change);
    const since = await d.git.head();
    project.run("checkout", "-q", "main");
    await expect(protectedErrors(d, change, POLICY, state, since)).rejects.toThrow("The agent switched the branch");
    expect(await project.git.currentBranch()).toBe("main");
  });
});
