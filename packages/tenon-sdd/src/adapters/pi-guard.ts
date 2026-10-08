import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { blockReason, type Policy } from "../entities/write-policy.js";
import { ENTRY } from "../use-cases/ports.js";
import { SDD_TOOLS, STAGE_TOOLS } from "../use-cases/stages.js";

/** The stage of this pi session, if the runner opened it. Each extension instance has its own. */
export type StageContext = { policy: Policy | undefined };

export function createStageContext(): StageContext {
  return { policy: undefined };
}

/** A stage session gets the tools of its stage. Any other session loses the sdd tools. */
export function onSessionStart(pi: ExtensionAPI, stage: StageContext, ctx: ExtensionContext): void {
  stage.policy = stagePolicy(ctx);
  if (stage.policy) pi.setActiveTools([...STAGE_TOOLS[stage.policy.kind]]);
  else pi.setActiveTools(pi.getActiveTools().filter((name) => !SDD_TOOLS.includes(name)));
}

/**
 * Block write and edit calls to paths that the stage cannot write.
 * Bash writes are not visible here: the runner checks the protected paths after each session.
 */
export function guardToolCall(stage: StageContext, event: ToolCallEvent, cwd: string): ToolCallEventResult | undefined {
  if (!stage.policy || (event.toolName !== "write" && event.toolName !== "edit")) return undefined;
  const target = String((event.input as { path?: unknown }).path ?? "");
  const path = relative(cwd, resolveLikePi(target, cwd)).split(sep).join("/");
  const reason = blockReason(path, stage.policy);
  return reason ? { block: true, reason } : undefined;
}

const UNICODE_SPACES = /[  -   　]/g;

/**
 * The path that pi's write and edit tools use (resolveToCwd in pi, not exported).
 * ponytail: no Git Bash drive paths (/c/x) on Windows; the guard then sees a path outside the project and blocks it.
 */
function resolveLikePi(input: string, cwd: string): string {
  let path = input.replace(UNICODE_SPACES, " ");
  if (path.startsWith("@")) path = path.slice(1);
  if (path === "~") path = homedir();
  else if (path.startsWith("~/")) path = join(homedir(), path.slice(2));
  else if (path.startsWith("file://")) path = fileURLToPath(path);
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function stagePolicy(ctx: ExtensionContext): Policy | undefined {
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "custom" && entry.customType === ENTRY.stage) return entry.data as Policy;
  }
  return undefined;
}
