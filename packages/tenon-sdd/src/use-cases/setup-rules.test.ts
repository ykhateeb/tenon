import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { createFakeProject, RULES } from "../testing/fake-project.js";
import { APPROVE, createFakeAgent, createFakePerson, testDeps } from "../testing/fakes.js";
import { setupRules } from "./setup-rules.js";
import { startChange } from "./start-change.js";

describe("setupRules", () => {
  it("runs the setup session until the person approves rules.md, then commits it", async () => {
    const project = createFakeProject({ withRules: false });
    const { agent, runs } = createFakeAgent(async () => project.write("sdd/rules.md", RULES));
    const { person, asked } = createFakePerson({ gates: [{ kind: "change", feedback: "Name the approvers." }, APPROVE] });
    const deps = testDeps(project, agent, person);
    const started = await startChange(deps, { request: "Sort", slug: "sort" });
    expect(await setupRules(deps, started)).toBe("approved");
    expect(runs.map((run) => run.policy.kind)).toEqual(["setup", "setup"]);
    expect(runs[1].message).toContain("Name the approvers.");
    expect(asked).toEqual(["Approve sdd/rules.md?", "Approve sdd/rules.md?"]);
    expect(await project.git.isCommitted("sdd/rules.md")).toBe(true);
  });

  it("never runs the full tier if the person stops at the first gate", async () => {
    const project = createFakeProject({ withRules: false });
    const rulesWithMarker = RULES.replace("Full tier: node fake-tests.mjs", "Full tier: touch /tmp/marker-file-12345 && node fake-tests.mjs");
    const { agent } = createFakeAgent(async () => project.write("sdd/rules.md", rulesWithMarker));
    const { person } = createFakePerson({ gates: [{ kind: "stop" }] });
    const deps = testDeps(project, agent, person);
    const started = await startChange(deps, { request: "Sort", slug: "sort" });
    expect(await setupRules(deps, started)).toBe("stopped");
    expect(existsSync("/tmp/marker-file-12345")).toBe(false);
  });

  it("asks the person again even when the agent changes nothing after a failed full tier", async () => {
    const project = createFakeProject({ withRules: false });
    const rulesInitial = RULES.replace("Full tier: node fake-tests.mjs", "Full tier: false"); // fail once
    const rulesFinal = RULES; // pass second time
    let callCount = 0;
    const { agent, runs: agentRuns } = createFakeAgent(async () => {
      callCount++;
      if (callCount === 1) {
        project.write("sdd/rules.md", rulesInitial);
      } else {
        project.write("sdd/rules.md", rulesFinal);
      }
    });
    const { person, asked } = createFakePerson({ gates: [APPROVE, APPROVE] });
    const deps = testDeps(project, agent, person);
    const started = await startChange(deps, { request: "Sort", slug: "sort" });
    expect(await setupRules(deps, started)).toBe("approved");
    expect(agentRuns.length).toBe(2);
    expect(asked).toEqual(["Approve sdd/rules.md?", "Approve sdd/rules.md?"]);
  });
});
