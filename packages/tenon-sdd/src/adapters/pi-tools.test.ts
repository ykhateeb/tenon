import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ENTRY } from "../use-cases/ports.js";

// typebox and pi come from the host at runtime; stub them here.
vi.mock("typebox", () => ({ Type: new Proxy({}, { get: () => () => ({}) }) }));
vi.mock("@earendil-works/pi-coding-agent", () => ({ defineTool: (tool: unknown) => tool }));

const { sddTools } = await import("./pi-tools.js");

type LooseTool = { name: string; execute: (...args: unknown[]) => Promise<{ content: { text: string }[]; terminate?: boolean }> };

function setup(policy = { kind: "spec" as const, changeDir: "sdd/changes/2026-10-08-sort", specLocked: false, lockedTests: [], testGlobs: [] }) {
  const entries: [string, unknown][] = [];
  const pi = { appendEntry: (type: string, data: unknown) => entries.push([type, data]) } as unknown as ExtensionAPI;
  const tools = sddTools(pi, { policy }) as unknown as LooseTool[];
  const tool = (name: string) => tools.find((candidate) => candidate.name === name) as LooseTool;
  return { entries, tools, tool };
}
const uiContext = (answers: (string | undefined)[], cwd = "/repo") => {
  const asked: unknown[] = [];
  return { asked, ctx: { cwd, ui: { select: async (_title: string, options: string[]) => (asked.push(options), answers.shift()), input: async () => answers.shift() } } };
};
const textOf = (result: { content: { text: string }[] }) => result.content[0].text;

describe("sddTools", () => {
  it("registers the four tools", () => {
    expect(setup().tools.map((tool) => tool.name)).toEqual(["ask_owner", "classify_change", "request_return", "report_review"]);
  });

  it("asks with the recommended option first and Other last", async () => {
    const { ctx, asked } = uiContext(["Date (recommended)"]);
    const result = await setup().tool("ask_owner").execute("1", { question: "Sort by?", why: "It changes the list.", options: ["Name", "Date"], recommended: "Date" }, undefined, undefined, ctx);
    expect(asked).toEqual([["Date (recommended)", "Name", "Other"]]);
    expect(textOf(result)).toBe("The owner answered: Date");
  });

  it("takes a typed answer after Other, and reports no answer", async () => {
    const other = uiContext(["Other", "Both"]);
    expect(textOf(await setup().tool("ask_owner").execute("1", { question: "Sort by?", why: "x", options: ["Name"], recommended: "Name" }, undefined, undefined, other.ctx))).toBe("The owner answered: Both");
    const closed = uiContext([undefined]);
    expect(textOf(await setup().tool("ask_owner").execute("2", { question: "Max items?", why: "x", recommended: "100" }, undefined, undefined, closed.ctx))).toMatch(/^No answer/);
  });

  it("records a valid classification and rejects an invalid one", async () => {
    const root = mkdtempSync(join(tmpdir(), "tenon-sdd-"));
    mkdirSync(join(root, "sdd/changes/2026-10-08-sort"), { recursive: true });
    const approved = { gate: "G1", result: "approved", commit: "c1", by: "Sam", at: "2026-10-08" };
    writeFileSync(join(root, "sdd/changes/2026-10-08-sort/state.json"), JSON.stringify({ owner: "Sam", base: "main", request: "x", size: "full", type: "change", specVersion: 1, stage: "spec", reviewRounds: 0, gates: [approved] }));
    const { tool, entries } = setup();
    await expect(tool("classify_change").execute("1", { type: "change", size: "small", reason: "x" }, undefined, undefined, { cwd: root })).rejects.toThrow(/after G1/);
    await tool("classify_change").execute("2", { type: "change", size: "full", reason: "x" }, undefined, undefined, { cwd: root });
    expect(entries).toEqual([[ENTRY.classify, { type: "change", size: "full" }]]);
  });

  it("records a return request and ends the turn, and records review findings", async () => {
    const { tool, entries } = setup();
    const result = await tool("request_return").execute("1", { stage: "tests", reason: "weak test" });
    expect(result.terminate).toBe(true);
    const finding = { file: "src/a.ts", problem: "duplicate helper", action: "reuse it", returnTo: "build" };
    await tool("report_review").execute("2", { findings: [finding] });
    expect(entries).toEqual([[ENTRY.returnRequest, { stage: "tests", reason: "weak test", size: undefined }], [ENTRY.review, { findings: [finding] }]]);
  });
});
