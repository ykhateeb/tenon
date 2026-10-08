import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createGit } from "./adapters/git.js";
import { createPiAgent } from "./adapters/pi-agent.js";
import { createStageContext, guardToolCall, onSessionStart } from "./adapters/pi-guard.js";
import { createPiPerson } from "./adapters/pi-person.js";
import { sddTools } from "./adapters/pi-tools.js";
import type { Deps } from "./use-cases/ports.js";
import { createRunner } from "./use-cases/run-change.js";

const COMMAND_TIMEOUT_MS = 30 * 60 * 1000;

export type SddOptions = { guidesDir?: string };

/** The composition root: the tools, the stage guard, and the /sdd command. Tenon passes guidesDir; terminal pi finds it next to src/. */
export default function tenonSdd(pi: ExtensionAPI, options: SddOptions = {}): void {
  const guidesDir = options.guidesDir ?? join(dirname(fileURLToPath(import.meta.url)), "../guides");
  const stage = createStageContext();
  for (const tool of sddTools(pi, stage)) pi.registerTool(tool);
  pi.on("session_start", (_event, ctx) => onSessionStart(pi, stage, ctx));
  pi.on("tool_call", (event, ctx) => guardToolCall(stage, event, ctx.cwd));
  pi.registerCommand("sdd", {
    description: "Spec-driven change: /sdd <request> starts one, /sdd continues the change of this branch",
    handler: (args, ctx) => runSdd(pi, guidesDir, args, ctx),
  });
}

async function runSdd(pi: ExtensionAPI, guidesDir: string, args: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) return ctx.ui.notify("/sdd needs a person to approve the gates, so it does not run without a UI.", "warning");
  if (!ctx.isProjectTrusted()) return ctx.ui.notify("/sdd runs only in a trusted project.", "warning");
  const agent = createPiAgent(ctx);
  const deps: Deps = { root: ctx.cwd, agent, person: createPiPerson(pi, agent), git: createGit(ctx.cwd), guidesDir, now: () => new Date(), timeoutMs: COMMAND_TIMEOUT_MS };
  const runner = createRunner(deps);
  const request = args.trim();
  try {
    await (request ? runner.start(request) : runner.resume());
  } catch (error) {
    deps.person.notify(`/sdd stopped: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}
