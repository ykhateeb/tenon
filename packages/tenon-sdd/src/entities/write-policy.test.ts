import { describe, expect, it } from "vitest";
import { blockReason, type Policy, type StageKind } from "./write-policy.js";

const DIR = "sdd/changes/2026-10-08-sort";
const policy = (kind: StageKind): Policy => ({
  kind,
  changeDir: DIR,
  specLocked: kind === "build",
  lockedTests: kind === "build" ? ["e2e/sort-us1-s1.e2e.ts"] : [],
  testGlobs: ["**/*.test.ts", "e2e/**/*.e2e.ts"],
});

describe("blockReason", () => {
  it.each<[StageKind, string, RegExp | undefined]>([
    ["setup", "sdd/rules.md", undefined],
    ["setup", "src/a.ts", /setup stage/],
    ["spec", `${DIR}/spec.md`, undefined],
    ["spec", `${DIR}/plan.md`, /spec stage/],
    ["plan", `${DIR}/plan.md`, undefined],
    ["tests", "src/a.test.ts", undefined],
    ["tests", `${DIR}/traceability.md`, undefined],
    ["tests", "src/a.ts", /tests stage/],
    ["build", "src/a.ts", undefined],
    ["build", `${DIR}/state.json`, /runner/],
    ["build", "sdd/areas/favorites.md", /Ship/],
    ["build", "sdd/rules.md", /review/],
    ["build", "sdd/changes/2026-09-14-old/spec.md", /frozen/],
    ["build", `${DIR}/spec.md`, /G1/],
    ["build", "e2e/sort-us1-s1.e2e.ts", /G2/],
    ["build", "E2E/Sort-US1-S1.e2e.ts", /G2/],
    ["build", "../outside.txt", /inside the project/],
    ["build", "/etc/passwd", /inside the project/],
    ["build", "C:/x.txt", /inside the project/],
    ["build", "sdd\\areas\\favorites.md", /inside the project/],
    ["build", "src/../sdd/areas/favorites.md", /inside the project/],
    ["build", "./sdd/areas/favorites.md", /Ship/],
    ["build", "src//a.ts", undefined],
    ["build", "sdd/areas", /Ship/],
    ["build", "sdd/changes", /frozen/],
    ["review", `${DIR}/outcome.md`, undefined],
    ["review", "src/a.ts", /review stage/],
  ])("%s stage, %s", (kind, path, expected) => {
    const reason = blockReason(path, policy(kind));
    if (expected) expect(reason).toMatch(expected);
    else expect(reason).toBeUndefined();
  });
});
