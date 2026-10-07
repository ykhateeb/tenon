import { matchesAny } from "./glob.js";

export type StageKind = "setup" | "spec" | "plan" | "tests" | "build" | "review";
export type Policy = { kind: StageKind; changeDir: string; specLocked: boolean; lockedTests: string[]; testGlobs: string[] };

type Allowed = { files: string[]; tests?: true; everything?: true };

const ALLOWED: Record<StageKind, (dir: string) => Allowed> = {
  setup: () => ({ files: ["sdd/rules.md"] }),
  spec: (dir) => ({ files: [`${dir}/spec.md`] }),
  plan: (dir) => ({ files: [`${dir}/plan.md`] }),
  tests: (dir) => ({ files: [`${dir}/traceability.md`, `${dir}/plan.md`], tests: true }),
  build: () => ({ files: [], everything: true }),
  review: (dir) => ({ files: [`${dir}/outcome.md`] }),
};

/**
 * Why a stage cannot write a path, or undefined if it can.
 * The file systems of macOS and Windows ignore case, so the check does too.
 */
export function blockReason(path: string, policy: Policy): string | undefined {
  const target = path.toLowerCase();
  const dir = policy.changeDir.toLowerCase();
  return protectedReason(target, dir, policy) ?? stageReason(target, dir, policy);
}

function protectedReason(target: string, dir: string, policy: Policy): string | undefined {
  if (target === ".." || target.startsWith("../")) return "Write only inside the project.";
  if (target === `${dir}/state.json`) return "state.json changes only through the runner.";
  if (target.startsWith("sdd/areas/")) return "Only Ship changes the area specs. Write the change in the delta of spec.md.";
  if (target === "sdd/rules.md" && policy.kind !== "setup") return "rules.md changes only by review, not inside a change.";
  if (target.startsWith("sdd/changes/") && !target.startsWith(`${dir}/`)) return "The folders of other changes are frozen.";
  if (policy.specLocked && target === `${dir}/spec.md`) return "spec.md is approved (G1). Use request_return with the stage spec.";
  if (policy.lockedTests.some((test) => test.toLowerCase() === target)) return "This test is approved (G2). Use request_return with the stage tests.";
  return undefined;
}

function stageReason(target: string, dir: string, policy: Policy): string | undefined {
  const allowed = ALLOWED[policy.kind](dir);
  const isTestFile = allowed.tests === true && matchesAny(target, policy.testGlobs.map((glob) => glob.toLowerCase()));
  if (allowed.everything || isTestFile || allowed.files.includes(target)) return undefined;
  const names = [...allowed.files, ...(allowed.tests ? ["test files"] : [])];
  return `In the ${policy.kind} stage you can write only ${names.join(", ")}.`;
}
