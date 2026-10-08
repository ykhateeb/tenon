import type { ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { Policy } from "../entities/write-policy.js";
import { ENTRY } from "../use-cases/ports.js";
import { createPiAgent, outcomeOf, type ReplacedSessionContext } from "./pi-agent.js";

const POLICY: Policy = { kind: "spec", changeDir: "sdd/changes/x", specLocked: false, lockedTests: [], testGlobs: [] };
const custom = (customType: string, data: unknown) => ({ type: "custom", customType, data }) as unknown as SessionEntry;
const assistant = (stopReason: string) => ({ type: "message", message: { role: "assistant", stopReason } }) as unknown as SessionEntry;

type NewSessionOptions = { parentSession?: string; setup?: (manager: unknown) => Promise<void>; withSession?: (ctx: ReplacedSessionContext) => Promise<void> };

describe("outcomeOf", () => {
  it("reads a stop by the person and the last result of each tool", () => {
    expect(outcomeOf([assistant("aborted")]).aborted).toBe(true);
    const entries = [
      custom(ENTRY.returnRequest, { stage: "tests", reason: "a" }),
      custom(ENTRY.returnRequest, { stage: "spec", reason: "b" }),
      custom(ENTRY.review, { findings: [] }),
      custom(ENTRY.classify, { type: "bug", size: "small" }),
      assistant("stop"),
    ];
    expect(outcomeOf(entries)).toEqual({ aborted: false, returnRequest: { stage: "spec", reason: "b" }, findings: [], classification: { type: "bug", size: "small" } });
  });
});

describe("createPiAgent", () => {
  it("opens a stage session with its title and policy, sends the message, and sends follow-ups to it", async () => {
    const branch: SessionEntry[] = [];
    const sent: string[] = [];
    const setupCalls: unknown[] = [];
    const stageSession = {
      sessionManager: { getBranch: () => branch },
      sendUserMessage: async (message: string) => {
        sent.push(message);
        branch.push(assistant("stop"));
      },
      waitForIdle: async () => {},
    } as unknown as ReplacedSessionContext;
    const start = {
      sessionManager: { getSessionFile: () => "/sessions/start.jsonl" },
      newSession: async ({ parentSession, setup, withSession }: NewSessionOptions) => {
        setupCalls.push(parentSession);
        await setup?.({ appendSessionInfo: (name: string) => setupCalls.push(name), appendCustomEntry: (type: string, data: unknown) => setupCalls.push([type, data]) });
        await withSession?.(stageSession);
        return { cancelled: false };
      },
    } as unknown as ExtensionCommandContext;
    const agent = createPiAgent(start);
    expect(await agent.run({ title: "sdd: spec (x)", message: "Read the guide.", policy: POLICY })).toEqual({ aborted: false, returnRequest: undefined, findings: undefined, classification: undefined });
    expect(setupCalls).toEqual(["/sessions/start.jsonl", "sdd: spec (x)", [ENTRY.stage, POLICY]]);
    expect(agent.context()).toBe(stageSession);
    expect(agent.stageSession()).toBe(stageSession);
    await agent.followUp("Correct the spec.");
    expect(sent).toEqual(["Read the guide.", "Correct the spec."]);
  });

  it("opens the second stage session from the first one, under the start session", async () => {
    const opened: { from: string; parent: string | undefined }[] = [];
    const contextNamed = (name: string): unknown => {
      const branch: SessionEntry[] = [];
      return {
        sessionManager: { getSessionFile: () => `/sessions/${name}.jsonl`, getBranch: () => branch },
        sendUserMessage: async () => void branch.push(assistant("stop")),
        waitForIdle: async () => {},
        newSession: async ({ parentSession, withSession }: NewSessionOptions) => {
          opened.push({ from: name, parent: parentSession });
          await withSession?.(contextNamed(`stage${opened.length}`) as ReplacedSessionContext);
          return { cancelled: false };
        },
      };
    };
    const agent = createPiAgent(contextNamed("start") as ExtensionCommandContext);
    await agent.run({ title: "sdd: plan (x)", message: "m", policy: POLICY });
    await agent.run({ title: "sdd: tests (x)", message: "m", policy: POLICY });
    expect(opened).toEqual([
      { from: "start", parent: "/sessions/start.jsonl" },
      { from: "stage1", parent: "/sessions/start.jsonl" },
    ]);
  });

  it("reports a cancelled session as a stop, and refuses a follow-up before a run", async () => {
    const start = { sessionManager: { getSessionFile: () => undefined }, newSession: async () => ({ cancelled: true }) } as unknown as ExtensionCommandContext;
    const agent = createPiAgent(start);
    await expect(agent.followUp("x")).rejects.toThrow(/Call run first/);
    expect((await agent.run({ title: "t", message: "m", policy: POLICY })).aborted).toBe(true);
  });
});
