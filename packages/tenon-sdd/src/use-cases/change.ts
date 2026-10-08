import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSpec, type Spec } from "../entities/delta.js";
import { parsePlan, type Task } from "../entities/plan.js";
import type { ParseResult } from "../entities/result.js";
import { parseRules, type Rules } from "../entities/rules.js";
import { parseState, type State } from "../entities/state.js";
import { parseTraceability, renderTraceability, type Traceability } from "../entities/traceability.js";

export type Change = { root: string; folder: string; slug: string; dir: string };
export type ChangeFile = "state.json" | "spec.md" | "plan.md" | "traceability.md" | "outcome.md";

export const RULES_PATH = "sdd/rules.md";
export const AREAS_DIR = "sdd/areas";

const CHANGE_BRANCH = /^sdd\/(\d{4}-\d{2}-\d{2}-(.+))$/;

export function changeOf(root: string, branch: string): Change | undefined {
  const match = CHANGE_BRANCH.exec(branch);
  return match ? { root, folder: match[1], slug: match[2], dir: `sdd/changes/${match[1]}` } : undefined;
}

export function pathOf(change: Change, file: ChangeFile): string {
  return `${change.dir}/${file}`;
}

/** The text of a file relative to the root, or undefined if it cannot be read. */
export async function readText(root: string, path: string): Promise<string | undefined> {
  return readFile(join(root, path), "utf8").catch(() => undefined);
}

export async function readState(change: Change): Promise<State> {
  const result = parseState((await readText(change.root, pathOf(change, "state.json"))) ?? "");
  if (!result.ok) throw new Error(`Cannot read ${pathOf(change, "state.json")}: ${result.errors.join(" ")}`);
  return result.value;
}

export function stateText(state: State): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export async function writeState(change: Change, state: State): Promise<void> {
  await writeFile(join(change.root, pathOf(change, "state.json")), stateText(state));
}

export async function readSpec(change: Change): Promise<ParseResult<Spec>> {
  const text = await readText(change.root, pathOf(change, "spec.md"));
  return text === undefined ? missing("spec.md") : parseSpec(text);
}

export async function readPlan(change: Change): Promise<ParseResult<Task[]>> {
  const text = await readText(change.root, pathOf(change, "plan.md"));
  return text === undefined ? missing("plan.md") : parsePlan(text);
}

export async function readTrace(change: Change): Promise<ParseResult<Traceability>> {
  const text = await readText(change.root, pathOf(change, "traceability.md"));
  return text === undefined ? missing("traceability.md") : parseTraceability(text);
}

export async function writeTrace(change: Change, trace: Traceability): Promise<void> {
  await writeFile(join(change.root, pathOf(change, "traceability.md")), renderTraceability(trace));
}

export async function readRules(root: string): Promise<Rules> {
  const result = parseRules((await readText(root, RULES_PATH)) ?? "");
  if (!result.ok) throw new Error(`${RULES_PATH} is not valid: ${result.errors.join(" ")}`);
  return result.value;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function missing(file: ChangeFile): { ok: false; errors: string[] } {
  return { ok: false, errors: [`Write ${file} in the change folder.`] };
}
