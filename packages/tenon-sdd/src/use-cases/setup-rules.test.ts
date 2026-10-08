import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { AREA, createFakeProject, RULES } from "../testing/fake-project.js";
import { APPROVE, createFakeAgent, createFakePerson, testDeps } from "../testing/fakes.js";
import { readState } from "./change.js";
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
    const markerPath = `${project.root}/reports/marker-setup-tier`;
    const rulesWithMarker = RULES.replace(
      "Full tier: node fake-tests.mjs",
      `Full tier: mkdir -p ${project.root}/reports && touch ${markerPath} && node fake-tests.mjs`
    );
    const { agent } = createFakeAgent(async () => project.write("sdd/rules.md", rulesWithMarker));
    const { person } = createFakePerson({ gates: [{ kind: "stop" }] });
    const deps = testDeps(project, agent, person);
    const started = await startChange(deps, { request: "Sort", slug: "sort" });
    expect(await setupRules(deps, started)).toBe("stopped");
    expect(existsSync(markerPath)).toBe(false);
  });

  it("asks the person again even when the agent changes nothing after a failed full tier", async () => {
    const project = createFakeProject({ withRules: false });
    const markerPath = `${project.root}/reports/.marker-setup-tier-2`;
    const rulesWithMarker = RULES.replace(
      "Full tier: node fake-tests.mjs",
      `Full tier: mkdir -p ${project.root}/reports && if [ -f ${markerPath} ]; then node fake-tests.mjs; else touch ${markerPath} && exit 1; fi`
    );
    let callCount = 0;
    const { agent, runs: agentRuns } = createFakeAgent(async () => {
      callCount++;
      if (callCount === 1) {
        project.write("sdd/rules.md", rulesWithMarker);
      }
      // Second call: agent does nothing (rules already written)
    });
    const { person, asked } = createFakePerson({ gates: [APPROVE, APPROVE] });
    const deps = testDeps(project, agent, person);
    const started = await startChange(deps, { request: "Sort", slug: "sort" });
    expect(await setupRules(deps, started)).toBe("approved");
    expect(agentRuns.length).toBe(2);
    expect(asked).toEqual(["Approve sdd/rules.md?", "Approve sdd/rules.md?"]);
  });

  it("protects area files during gate: the runner restores the protected file and shows the gate again", async () => {
    const project = createFakeProject({ withRules: false });
    let gateCallCount = 0;
    const { agent, runs: agentRuns } = createFakeAgent(async () => project.write("sdd/rules.md", RULES));
    const { person } = createFakePerson({ gates: [APPROVE, APPROVE] });
    const originalGate = person.gate;
    person.gate = async (question: string, summary: string) => {
      gateCallCount++;
      if (gateCallCount === 1) {
        // During first gate, write to protected area file
        project.write("sdd/areas/favorites.md", "modified\n");
      }
      return await originalGate.call(person, question, summary);
    };

    const deps = testDeps(project, agent, person);
    const started = await startChange(deps, { request: "Sort", slug: "sort" });
    const result = await setupRules(deps, started);
    expect(result).toBe("approved");
    expect(gateCallCount).toBe(2);
    expect(agentRuns.length).toBe(1);
    const areaAtHead = await project.git.fileAt("HEAD", "sdd/areas/favorites.md");
    expect(areaAtHead + "\n").toBe(AREA);
    expect(project.read("sdd/areas/favorites.md")).toBe(AREA);
  });
});
