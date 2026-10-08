import { describe, expect, it } from "vitest";
import { createFakeProject } from "../testing/fake-project.js";
import { createFakeAgent, createFakePerson, testDeps } from "../testing/fakes.js";
import { startChange, suggestSlug } from "./start-change.js";

const depsOf = (project: ReturnType<typeof createFakeProject>) => testDeps(project, createFakeAgent(async () => {}).agent, createFakePerson({}).person);

describe("suggestSlug", () => {
  it("keeps at most 5 lower case words", () => {
    expect(suggestSlug("Sort favorites by date, newest first!")).toBe("sort-favorites-by-date-newest");
  });

  it("gives change for a request with no Latin letters", () => {
    expect(suggestSlug("ترتيب المفضلة حسب التاريخ")).toBe("change");
  });
});

describe("startChange", () => {
  it("makes the branch, the folder, and the first state, and commits them", async () => {
    const project = createFakeProject();
    const change = await startChange(depsOf(project), { request: "Sort favorites", slug: "sort" });
    expect(change).toMatchObject({ folder: "2026-10-08-sort", slug: "sort", dir: "sdd/changes/2026-10-08-sort" });
    expect(project.run("branch", "--show-current")).toBe("sdd/2026-10-08-sort");
    expect(JSON.parse(project.read(`${change.dir}/state.json`))).toMatchObject({ owner: "Sam", base: "main", request: "Sort favorites", stage: "spec", specVersion: 1, gates: [] });
    expect(project.run("status", "--porcelain")).toBe("");
  });

  it("adds -2 when an earlier change used the slug", async () => {
    const project = createFakeProject();
    project.write("sdd/changes/2026-09-01-sort/state.json", "{}\n");
    project.run("add", "-A");
    project.run("commit", "-q", "-m", "an old change");
    expect((await startChange(depsOf(project), { request: "Sort again", slug: "sort" })).slug).toBe("sort-2");
  });
});
