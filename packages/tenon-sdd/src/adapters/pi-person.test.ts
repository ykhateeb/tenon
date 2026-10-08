import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { PiAgent } from "./pi-agent.js";
import { createPiPerson } from "./pi-person.js";

const uiWith = (answers: (string | undefined)[]) => ({ select: async () => answers.shift(), input: async () => answers.shift(), notify: () => {} });

describe("createPiPerson", () => {
  it("shows the summary in the stage session, and maps Change to the feedback", async () => {
    const shown: unknown[] = [];
    const stage = { ui: uiWith(["Change", "Add a test."]), sendMessage: async (message: unknown) => void shown.push(message) };
    const agent = { context: () => stage, stageSession: () => stage } as unknown as PiAgent;
    const pi = { sendMessage: () => { throw new Error("the stage session must show it"); } } as unknown as ExtensionAPI;
    expect(await createPiPerson(pi, agent).gate("G1: ok?", "## G1")).toEqual({ kind: "change", feedback: "Add a test." });
    expect(shown).toEqual([{ customType: "sdd-gate", content: "## G1", display: true }]);
  });

  it("uses pi before any stage session, and a closed dialog or empty feedback is Stop", async () => {
    const shown: unknown[] = [];
    const start = { ui: uiWith([undefined, "Change", ""]) };
    const agent = { context: () => start, stageSession: () => undefined } as unknown as PiAgent;
    const pi = { sendMessage: (message: unknown) => void shown.push(message) } as unknown as ExtensionAPI;
    const person = createPiPerson(pi, agent);
    expect(await person.gate("G2: ok?", "## G2")).toEqual({ kind: "stop" });
    expect(await person.gate("G2: ok?", "## G2")).toEqual({ kind: "stop" });
    expect(shown).toHaveLength(2);
  });
});
