import type { Agent, Deps, GateAnswer, Person, StageOutcome, StageRun } from "../use-cases/ports.js";
import type { FakeProject } from "./fake-project.js";

export type AgentScript = (run: StageRun, count: number) => Promise<Partial<StageOutcome> | void>;

export const APPROVE: GateAnswer = { kind: "approve" };
export const STOP: GateAnswer = { kind: "stop" };
export const change = (feedback: string): GateAnswer => ({ kind: "change", feedback });

/** An Agent that runs a script for each stage session and records each run and follow-up. */
export function createFakeAgent(script: AgentScript, onFollowUp: (message: string) => Promise<Partial<StageOutcome> | void> = async () => {}) {
  const runs: StageRun[] = [];
  const followUps: string[] = [];
  const agent: Agent = {
    async run(run) {
      runs.push(run);
      return { aborted: false, ...(await script(run, runs.length)) };
    },
    async followUp(message) {
      followUps.push(message);
      return { aborted: false, ...(await onFollowUp(message)) };
    },
  };
  return { agent, runs, followUps };
}

/** A Person with scripted answers. A missing gate answer is Stop. */
export function createFakePerson({ gates = [], choices = [], inputs = [] }: { gates?: GateAnswer[]; choices?: (string | undefined)[]; inputs?: (string | undefined)[] }) {
  const asked: string[] = [];
  const notices: string[] = [];
  const person: Person = {
    async gate(question) {
      asked.push(question);
      return gates.shift() ?? STOP;
    },
    async choose() {
      return choices.shift();
    },
    async input() {
      return inputs.shift();
    },
    notify(message) {
      notices.push(message);
    },
  };
  return { person, asked, notices };
}

export function testDeps(project: FakeProject, agent: Agent, person: Person): Deps {
  return { root: project.root, agent, person, git: project.git, guidesDir: "/guides", now: () => new Date("2026-10-08T12:00:00Z"), timeoutMs: 60_000 };
}
