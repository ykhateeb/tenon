import type { Spec } from "./delta.js";
import { parsed, type ParseResult } from "./result.js";

export type Task = {
  id: string;
  done: boolean;
  isTest: boolean;
  isParallel: boolean;
  refs: string[];
  file: string | undefined;
  phase: string;
};

const PHASE = /^### (.+)$/;
const TASK = /^- \[( |x)\] (T\d{3,}) (.*)$/;
const BRACKETS = /\[([^\]]+)\]/g;
const FILE = /\bin (\S+?)[;,]?(?=\s|$)/g;

/** Parse the task lines of plan.md: `- [ ] T001 (test) [P] [ID, ID] <text> in <file>`. */
export function parsePlan(markdown: string): ParseResult<Task[]> {
  const tasks: Task[] = [];
  let phase = "";
  for (const line of markdown.split(/\r?\n/).map((text) => text.trim())) {
    phase = PHASE.exec(line)?.[1] ?? phase;
    const task = TASK.exec(line);
    if (task) tasks.push(toTask(task, phase));
  }
  return parsed(tasks, tasks.length ? [] : ['plan.md has no task lines ("- [ ] T001 …").']);
}

/** Each delta ID has a task, each scenario has a test task, and parallel tasks do not share a file. */
export function consistencyErrors(tasks: readonly Task[], spec: Spec): string[] {
  const refs = new Set(tasks.flatMap((task) => task.refs));
  const testRefs = new Set(tasks.filter((task) => task.isTest).flatMap((task) => task.refs));
  return [
    ...spec.delta.filter((item) => !refs.has(item.id)).map((item) => `No task names ${item.id}.`),
    ...spec.scenarios.filter((scenario) => !testRefs.has(scenario.id)).map((scenario) => `No (test) task names ${scenario.id}.`),
    ...parallelClashes(tasks),
  ];
}

function toTask([, mark, id, rest]: RegExpExecArray, phase: string): Task {
  const groups = [...rest.matchAll(BRACKETS)].map((match) => match[1]);
  return {
    id,
    done: mark === "x",
    isTest: rest.includes("(test)"),
    isParallel: groups.includes("P"),
    refs: groups.filter((group) => group !== "P").flatMap((group) => group.split(",").map((ref) => ref.trim())),
    file: extractFile(rest),
    phase,
  };
}

function extractFile(text: string): string | undefined {
  const matches = [...text.matchAll(FILE)];
  let lastPath: string | undefined;
  for (const match of matches) {
    const token = match[1];
    // Iteratively remove backticks and trailing punctuation until stable
    let cleaned = token;
    let prev: string;
    do {
      prev = cleaned;
      // Remove backticks from start and end
      cleaned = cleaned.replace(/^`+|`+$/g, "");
      // Remove trailing punctuation
      cleaned = cleaned.replace(/[.,;:)]+$/, "");
    } while (cleaned !== prev);
    // Only accept if not empty and contains "/" or "."
    if (cleaned && (cleaned.includes("/") || cleaned.includes("."))) {
      lastPath = cleaned;
    }
  }
  return lastPath;
}

function parallelClashes(tasks: readonly Task[]): string[] {
  const owners = new Map<string, string>();
  const errors: string[] = [];
  for (const task of tasks.filter((candidate) => candidate.isParallel && candidate.file)) {
    const key = `${task.phase}\n${task.file}`;
    const owner = owners.get(key);
    if (owner) errors.push(`${owner} and ${task.id} run in parallel but both change ${task.file}.`);
    else owners.set(key, task.id);
  }
  return errors;
}
