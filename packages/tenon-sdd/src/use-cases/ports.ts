import type { Git } from "../adapters/git.js";
import type { Classification } from "../entities/state.js";
import type { Policy } from "../entities/write-policy.js";

/** Custom entry types in pi session files. */
export const ENTRY = { stage: "sdd-stage", classify: "sdd-classify", returnRequest: "sdd-return", review: "sdd-review" } as const;

export type ReturnStage = "spec" | "plan" | "tests" | "build";
export type ReturnRequest = { stage: ReturnStage; reason: string; size?: "full" };
export type Finding = { file: string; problem: string; action: string; returnTo: ReturnStage };

/** One stage session: its title, its first message, and the write policy that its extension instance reads. */
export type StageRun = { title: string; message: string; policy: Policy };
export type StageOutcome = { aborted: boolean; returnRequest?: ReturnRequest; findings?: Finding[]; classification?: Classification };

export interface Agent {
  /** Open a new session for the stage, send the message, and wait until the session is idle. */
  run(stage: StageRun): Promise<StageOutcome>;
  /** Send a message to the last stage session and wait until it is idle. */
  followUp(message: string): Promise<StageOutcome>;
}

export type GateAnswer = { kind: "approve" } | { kind: "change"; feedback: string } | { kind: "stop" };

export interface Person {
  /** Show the summary, then ask Approve, Change, or Stop. */
  gate(question: string, summary: string): Promise<GateAnswer>;
  choose(title: string, options: string[]): Promise<string | undefined>;
  /** Ask for text. The hint shows in the empty field. */
  input(title: string, hint: string): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning" | "error"): void;
}

export type Deps = { root: string; agent: Agent; person: Person; git: Git; guidesDir: string; now: () => Date; timeoutMs: number };
