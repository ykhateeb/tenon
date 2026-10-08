import { describe, expect, it } from "vitest";
import { createFakeProject, RULES } from "../testing/fake-project.js";
import { APPROVE, change, createFakeAgent, createFakePerson, testDeps } from "../testing/fakes.js";
import { setupRules } from "./setup-rules.js";
import { startChange } from "./start-change.js";

describe("setupRules", () => {
  it("runs the setup session until the person approves rules.md, then commits it", async () => {
    const project = createFakeProject({ withRules: false });
    const { agent, runs } = createFakeAgent(async () => project.write("sdd/rules.md", RULES));
    const { person, asked } = createFakePerson({ gates: [change("Name the approvers."), APPROVE] });
    const deps = testDeps(project, agent, person);
    const started = await startChange(deps, { request: "Sort", slug: "sort" });
    expect(await setupRules(deps, started)).toBe("approved");
    expect(runs.map((run) => run.policy.kind)).toEqual(["setup", "setup"]);
    expect(runs[1].message).toContain("Name the approvers.");
    expect(asked).toEqual(["Approve sdd/rules.md?", "Approve sdd/rules.md?"]);
    expect(await project.git.isCommitted("sdd/rules.md")).toBe(true);
  });
});
