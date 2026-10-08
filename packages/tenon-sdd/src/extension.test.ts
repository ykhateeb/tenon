import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

// typebox and pi come from the host at runtime; stub them here.
vi.mock("typebox", () => ({ Type: new Proxy({}, { get: () => () => ({}) }) }));
vi.mock("@earendil-works/pi-coding-agent", () => ({ defineTool: (tool: unknown) => tool }));

const { default: tenonSdd } = await import("./extension.js");

type Command = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };

function load() {
  const tools: string[] = [];
  const events: string[] = [];
  const commands = new Map<string, Command>();
  tenonSdd(
    {
      registerTool: (tool: { name: string }) => tools.push(tool.name),
      on: (event: string) => events.push(event),
      registerCommand: (name: string, command: Command) => commands.set(name, command),
    } as unknown as ExtensionAPI,
    { guidesDir: "/guides" },
  );
  return { tools, events, commands };
}

describe("tenonSdd", () => {
  it("registers the tools, the session handlers, and the /sdd command", () => {
    const { tools, events, commands } = load();
    expect(tools).toEqual(["ask_owner", "classify_change", "request_return", "report_review"]);
    expect(events).toEqual(["session_start", "tool_call"]);
    expect([...commands.keys()]).toEqual(["sdd"]);
  });

  it("refuses to run with no UI, or in a project that is not trusted", async () => {
    const notices: string[] = [];
    const ctx = (hasUI: boolean, isTrusted: boolean) => ({ hasUI, isProjectTrusted: () => isTrusted, ui: { notify: (message: string) => notices.push(message) } }) as unknown as ExtensionCommandContext;
    const sdd = load().commands.get("sdd");
    await sdd?.handler("Sort favorites", ctx(false, true));
    await sdd?.handler("Sort favorites", ctx(true, false));
    expect(notices).toEqual(["/sdd needs a person to approve the gates, so it does not run without a UI.", "/sdd runs only in a trusted project."]);
  });
});
