import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Policy } from "../entities/write-policy.js";
import { ENTRY } from "../use-cases/ports.js";
import { createStageContext, guardToolCall, onSessionStart } from "./pi-guard.js";

const POLICY: Policy = { kind: "build", changeDir: "sdd/changes/2026-10-08-sort", specLocked: true, lockedTests: [], testGlobs: [] };
const contextWith = (entries: unknown[]) => ({ sessionManager: { getEntries: () => entries } }) as unknown as ExtensionContext;
const writeEvent = (path: string, toolName = "write") => ({ toolName, input: { path } }) as unknown as ToolCallEvent;

describe("onSessionStart", () => {
  it("gives a stage session the tools of its stage, and takes the sdd tools from other sessions", () => {
    let active = ["read", "bash", "ask_owner", "report_review"];
    const pi = { setActiveTools: (names: string[]) => (active = names), getActiveTools: () => active } as unknown as ExtensionAPI;
    const stage = createStageContext();
    onSessionStart(pi, stage, contextWith([{ type: "custom", customType: ENTRY.stage, data: POLICY }]));
    expect(active).toEqual(["read", "grep", "find", "ls", "bash", "write", "edit", "request_return"]);
    expect(stage.policy).toEqual(POLICY);
    onSessionStart(pi, stage, contextWith([]));
    expect(active).toEqual(["read", "grep", "find", "ls", "bash", "write", "edit"]);
    expect(stage.policy).toBeUndefined();
  });
});

describe("guardToolCall", () => {
  it("normalizes the path before the policy", () => {
    const stage = { policy: POLICY };
    expect(guardToolCall(stage, writeEvent("./sdd/areas/favorites.md"), "/repo")?.block).toBe(true);
    expect(guardToolCall(stage, writeEvent("/repo/SDD/Areas/favorites.md", "edit"), "/repo")?.block).toBe(true);
    expect(guardToolCall(stage, writeEvent("/repo/src/a.ts"), "/repo")).toBeUndefined();
  });

  it("does not guard other tools or sessions with no stage", () => {
    expect(guardToolCall({ policy: POLICY }, writeEvent("sdd/areas/favorites.md", "read"), "/repo")).toBeUndefined();
    expect(guardToolCall(createStageContext(), writeEvent("sdd/areas/favorites.md"), "/repo")).toBeUndefined();
  });

  describe("resolves the path as pi does", () => {
    it("strips @ prefix", () => {
      const stage = { policy: POLICY };
      expect(guardToolCall(stage, writeEvent("@sdd/areas/favorites.md"), "/repo")?.block).toBe(true);
    });

    it("resolves file:// URLs", () => {
      const stage = { policy: POLICY };
      expect(guardToolCall(stage, writeEvent("file:///repo/sdd/areas/favorites.md"), "/repo")?.block).toBe(true);
    });

    it("expands ~ relative to homedir", () => {
      const stage = { policy: POLICY };
      expect(guardToolCall(stage, writeEvent("~/sdd/areas/favorites.md"), homedir())?.block).toBe(true);
    });

    it("allows @ prefix paths that are outside the change dir", () => {
      const stage = { policy: POLICY };
      expect(guardToolCall(stage, writeEvent("@src/a.ts"), "/repo")).toBeUndefined();
    });
  });
});
