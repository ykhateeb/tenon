import { describe, expect, it } from "vitest";
import { approvalOf, classificationError, gateAfter, nextStage, parseState, returnedTo, withApproval, type Gate, type Stage, type State } from "./state.js";

const state = (patch: Partial<State> = {}): State => ({
  owner: "Sam",
  base: "main",
  request: "Sort favorites",
  size: "full",
  type: "feature",
  specVersion: 1,
  stage: "spec",
  reviewRounds: 0,
  gates: [],
  ...patch,
});
const approved = (gate: Gate, commit = "abc") => ({ gate, result: "approved" as const, commit, by: "Sam", at: "2026-10-08" });

describe("parseState", () => {
  it("reads a valid file", () => {
    expect(parseState(JSON.stringify(state()))).toEqual({ ok: true, value: state() });
  });

  it("rejects bad JSON, a list, and an unknown stage", () => {
    expect(parseState("{").ok).toBe(false);
    expect(parseState("[]").ok).toBe(false);
    expect(parseState(JSON.stringify({ ...state(), stage: "deploy" })).ok).toBe(false);
  });

  it("rejects a missing specVersion", () => {
    const s = { ...state() };
    delete (s as any).specVersion;
    expect(parseState(JSON.stringify(s)).ok).toBe(false);
  });

  it("rejects a null gate entry", () => {
    expect(parseState(JSON.stringify({ ...state(), gates: [null] })).ok).toBe(false);
  });

  it("rejects an unknown size", () => {
    expect(parseState(JSON.stringify({ ...state(), size: "medium" })).ok).toBe(false);
  });
});

describe("gateAfter", () => {
  it("has three gates in the full size and only G3 in the small size", () => {
    const full: Stage[] = ["spec", "plan", "tests", "build", "ship"];
    const small: Stage[] = ["spec", "tests", "build", "ship"];
    expect(full.map((stage) => gateAfter(stage, "full"))).toEqual(["G1", undefined, "G2", undefined, "G3"]);
    expect(small.map((stage) => gateAfter(stage, "small"))).toEqual([undefined, undefined, undefined, "G3"]);
  });
});

describe("nextStage", () => {
  it("skips Plan in the small size and Tests for docs", () => {
    expect(nextStage(state({ stage: "spec" }))).toBe("plan");
    expect(nextStage(state({ stage: "spec", size: "small", type: "bug" }))).toBe("tests");
    expect(nextStage(state({ stage: "spec", size: "small", type: "docs" }))).toBe("build");
    expect(nextStage(state({ stage: "ship" }))).toBe("done");
  });

  it("skips Plan when starting from it in small size", () => {
    expect(nextStage(state({ stage: "plan", size: "small" }))).toBe("tests");
  });

  it("skips Tests when starting from it with docs type", () => {
    expect(nextStage(state({ stage: "tests", type: "docs" }))).toBe("build");
  });

  it("transitions through the middle stages", () => {
    expect(nextStage(state({ stage: "tests" }))).toBe("build");
  });
});

describe("approvalOf", () => {
  it("uses the last entry of the gate", () => {
    const reopened = { gate: "G1" as const, result: "reopened" as const, reason: "x", by: "runner", at: "2026-10-09" };
    expect(approvalOf(state({ gates: [approved("G1")] }), "G1")?.commit).toBe("abc");
    expect(approvalOf(state({ gates: [approved("G1"), reopened] }), "G1")).toBeUndefined();
  });
});

describe("withApproval", () => {
  it("adds the entry, and G3 makes the change done", () => {
    expect(withApproval(state({ stage: "spec" }), { gate: "G1", commit: "c1", by: "Sam", at: "2026-10-08" }).stage).toBe("spec");
    expect(withApproval(state({ stage: "ship" }), { gate: "G3", commit: "c3", by: "Sam", at: "2026-10-08" })).toMatchObject({ stage: "done", gates: [approved("G3", "c3")] });
  });
});

describe("returnedTo", () => {
  const order = { reason: "weak test", by: "runner", at: "2026-10-10" };

  it("reopens each approved gate at or after the target", () => {
    const next = returnedTo(state({ stage: "build", gates: [approved("G1"), approved("G2")] }), { target: "tests", ...order });
    expect(next.stage).toBe("tests");
    expect(next.gates.slice(2)).toEqual([{ gate: "G2", result: "reopened", ...order }]);
    expect(next.specVersion).toBe(1);
  });

  it("increases the spec version on a return to Spec after G1", () => {
    expect(returnedTo(state({ stage: "build", gates: [approved("G1")] }), { target: "spec", ...order }).specVersion).toBe(2);
    expect(returnedTo(state({ stage: "tests" }), { target: "spec", ...order }).specVersion).toBe(1);
  });

  it("sets size to full when returning to Plan from small size", () => {
    const next = returnedTo(state({ stage: "tests", size: "small" }), { target: "plan", ...order });
    expect(next.size).toBe("full");
    expect(next.stage).toBe("plan");
  });
});

describe("classificationError", () => {
  it("rejects a small feature and a full change that becomes small after G1", () => {
    expect(classificationError(state(), { type: "feature", size: "small" })).toMatch(/always full/);
    expect(classificationError(state({ type: "change", gates: [approved("G1")] }), { type: "change", size: "small" })).toMatch(/after G1/);
    expect(classificationError(state(), { type: "bug", size: "small" })).toBeUndefined();
  });
});
