import { describe, expect, it } from "vitest";
import { AREA, createFakeProject } from "../testing/fake-project.js";
import { createFakeAgent, createFakePerson, testDeps } from "../testing/fakes.js";
import { readState } from "./change.js";
import { returnChange } from "./return-change.js";
import { startChange } from "./start-change.js";

describe("returnChange", () => {
  it("sets the stage, reopens the gates, undoes the area spec edits of Ship, and commits", async () => {
    const project = createFakeProject();
    const deps = testDeps(project, createFakeAgent(async () => {}).agent, createFakePerson({}).person);
    const change = await startChange(deps, { request: "Sort", slug: "sort" });
    const approved = { gate: "G2" as const, result: "approved" as const, commit: "c2", by: "Sam", at: "2026-10-08" };
    const state = { ...(await readState(change)), stage: "ship" as const, gates: [approved] };
    project.write("sdd/areas/favorites.md", `${AREA}- edited by Ship\n`);
    project.run("commit", "-qam", "apply the delta");
    const next = await returnChange(deps, change, state, { stage: "tests", reason: "weak test" });
    expect(next.stage).toBe("tests");
    expect(next.gates.at(-1)).toEqual({ gate: "G2", result: "reopened", reason: "weak test", by: "runner", at: "2026-10-08" });
    expect(project.read("sdd/areas/favorites.md")).toBe(AREA);
    expect(await readState(change)).toEqual(next);
    expect(project.run("log", "-1", "--format=%s")).toBe("sdd(sort): return to tests");
  });
});
