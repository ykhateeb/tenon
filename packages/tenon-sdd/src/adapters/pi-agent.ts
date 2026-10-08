import type { ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { ENTRY, type Agent, type Finding, type ReturnRequest, type StageOutcome, type StageRun } from "../use-cases/ports.js";
import type { Classification } from "../entities/state.js";

type NewSessionOptions = NonNullable<Parameters<ExtensionCommandContext["newSession"]>[0]>;
/** pi does not export this type from its root, so take it from the newSession option. */
export type ReplacedSessionContext = Parameters<NonNullable<NewSessionOptions["withSession"]>>[0];

export type PiAgent = Agent & {
  /** The context of the newest session: the start chat, or the last stage session. */
  context(): ExtensionCommandContext;
  /** The last stage session, if the runner opened one. It can show messages. */
  stageSession(): ReplacedSessionContext | undefined;
};

/**
 * Each stage runs in a new pi session under the start chat. pi loads a new extension instance for it,
 * so the policy goes into the session as a custom entry, and the tools report back through custom entries.
 */
export function createPiAgent(start: ExtensionCommandContext): PiAgent {
  const parentSession = start.sessionManager.getSessionFile();
  let current: ExtensionCommandContext = start;
  let stage: ReplacedSessionContext | undefined;
  return {
    context: () => current,
    stageSession: () => stage,
    async run({ title, message, policy }: StageRun): Promise<StageOutcome> {
      let outcome: StageOutcome = { aborted: true };
      const result = await current.newSession({
        parentSession,
        setup: async (sessionManager) => {
          sessionManager.appendSessionInfo(title);
          sessionManager.appendCustomEntry(ENTRY.stage, policy);
        },
        withSession: async (ctx) => {
          current = ctx;
          stage = ctx;
          outcome = await send(ctx, message);
        },
      });
      return result.cancelled ? { aborted: true } : outcome;
    },
    async followUp(message: string): Promise<StageOutcome> {
      if (!stage) throw new Error("A follow-up needs a stage session. Call run first.");
      return send(stage, message);
    },
  };
}

/** What the agent reported in these session entries: a stop by the person, and the last result of each sdd tool. */
export function outcomeOf(entries: readonly SessionEntry[]): StageOutcome {
  return {
    aborted: lastStopReason(entries) === "aborted",
    returnRequest: lastData<ReturnRequest>(entries, ENTRY.returnRequest),
    findings: lastData<{ findings: Finding[] }>(entries, ENTRY.review)?.findings,
    classification: lastData<Classification>(entries, ENTRY.classify),
  };
}

async function send(ctx: ReplacedSessionContext, message: string): Promise<StageOutcome> {
  const before = ctx.sessionManager.getBranch().length;
  await ctx.sendUserMessage(message);
  await ctx.waitForIdle();
  return outcomeOf(ctx.sessionManager.getBranch().slice(before));
}

function lastData<T>(entries: readonly SessionEntry[], customType: string): T | undefined {
  const entry = entries.filter((candidate) => candidate.type === "custom" && candidate.customType === customType).at(-1);
  return entry?.type === "custom" ? (entry.data as T) : undefined;
}

function lastStopReason(entries: readonly SessionEntry[]): string | undefined {
  for (const entry of [...entries].reverse()) {
    if (entry.type === "message" && entry.message.role === "assistant") return entry.message.stopReason;
  }
  return undefined;
}
