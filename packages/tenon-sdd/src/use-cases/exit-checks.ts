import { existsSync } from "node:fs";
import { join } from "node:path";
import { readReports, removeReports } from "../adapters/junit.js";
import { runCommand } from "../adapters/shell.js";
import { hasRequirement, staleErrors } from "../entities/area-spec.js";
import { sizeErrors, type Spec } from "../entities/delta.js";
import { hasSection } from "../entities/markdown.js";
import { consistencyErrors } from "../entities/plan.js";
import { errorsOf } from "../entities/result.js";
import { parseRules, type Rules } from "../entities/rules.js";
import type { State } from "../entities/state.js";
import { buildStageErrors, testsStageErrors, withStatuses, withVerdicts, type TestCase, type TestMode } from "../entities/traceability.js";
import { areaFrom, areasOf, areaWithPrefix, readAreas } from "./areas.js";
import { AREAS_DIR, pathOf, readPlan, readSpec, readText, readTrace, RULES_PATH, writeTrace, type Change } from "./change.js";
import type { Deps } from "./ports.js";

export type FullTier = { code: number | null; output: string; cases: TestCase[]; errors: string[] };

const OUTPUT_TAIL = 4000;
const OUTCOME_SECTIONS = ["Delivered", "Evidence", "Changed after approval", "Left open"];

/** Run the full tier and read its JUnit reports. Old reports are deleted first, so a stale report cannot pass. */
export async function runFullTier(deps: Deps, rules: Rules): Promise<FullTier> {
  await removeReports(deps.root, rules.junitReports);
  const result = await runCommand(rules.fullTier, { cwd: deps.root, timeoutMs: deps.timeoutMs });
  const output = result.output.slice(-OUTPUT_TAIL);
  if (result.timedOut) {
    return { code: result.code, output, cases: [], errors: [`The full tier ran longer than ${deps.timeoutMs / 60_000} minutes and was stopped. Output:\n${output}`] };
  }
  const { cases, missing } = await readReports(deps.root, rules.junitReports);
  await removeReports(deps.root, rules.junitReports);
  return { code: result.code, output, cases, errors: missing.map((glob) => `The full tier wrote no JUnit report that matches ${glob}. Output:\n${output}`) };
}

export async function setupErrors(deps: Deps): Promise<string[]> {
  const text = await readText(deps.root, RULES_PATH);
  if (text === undefined) return [`Write ${RULES_PATH}.`];
  const rules = parseRules(text);
  return rules.ok ? (await runFullTier(deps, rules.value)).errors : rules.errors;
}

/** The exit check of the current stage. Ship has its own check (shipErrors). */
export async function exitErrors(deps: Deps, change: Change, state: State, rules: Rules): Promise<string[]> {
  if (state.stage === "spec") return specErrors(deps, change, state);
  if (state.stage === "plan") return planErrors(change);
  if (state.stage === "tests") return testsErrors(deps, change, state, rules);
  if (state.stage === "build") return buildErrors(deps, change, state, rules);
  return [];
}

export async function shipErrors(deps: Deps, rules: Rules, change: Change, isReviewed: boolean): Promise<string[]> {
  const outcome = (await readText(deps.root, pathOf(change, "outcome.md"))) ?? "";
  const tier = await runFullTier(deps, rules);
  return [
    ...(isReviewed ? [] : ["Call report_review with your findings. Give an empty list if there are none."]),
    ...OUTCOME_SECTIONS.filter((section) => !hasSection(outcome, section)).map((section) => `outcome.md needs the section "## ${section}".`),
    ...(tier.errors.length ? tier.errors : failingCases(tier)),
  ];
}

export function failingCases(tier: FullTier): string[] {
  const failed = tier.cases.filter((testCase) => testCase.result === "failed").map((testCase) => testCase.name);
  if (failed.length) return [`The full tier has failing tests: ${failed.join(", ")}.`];
  return tier.code === 0 ? [] : [`The full tier exited with the code ${tier.code ?? "none"}. Output:\n${tier.output}`];
}

async function specErrors(deps: Deps, change: Change, state: State): Promise<string[]> {
  const spec = await readSpec(change);
  if (!spec.ok) return spec.errors;
  return [
    ...spec.value.openQuestions.map((question) => `An open question is left: "${question}". Ask the owner with ask_owner, and write the answer into the spec.`),
    ...sizeErrors(spec.value, state),
    ...(await dryRunErrors(deps.root, spec.value)),
  ];
}

/** The delta against the area specs of the working tree: each MODIFIED and REMOVED item must still match. */
async function dryRunErrors(root: string, spec: Spec): Promise<string[]> {
  const errors: string[] = [];
  for (const name of areasOf(spec)) {
    const area = areaFrom(name, await readText(root, `${AREAS_DIR}/${name}.md`), spec);
    errors.push(...(area.ok ? staleErrors(area.value, spec.delta.filter((item) => item.area === name)) : area.errors));
  }
  if (spec.requirement && !(await requirementExists(root, spec.requirement))) errors.push(`No area spec has the requirement ${spec.requirement}.`);
  return errors;
}

async function requirementExists(root: string, id: string): Promise<boolean> {
  const areas = await readAreas(root);
  const name = areaWithPrefix(areas, id);
  const area = name === undefined ? undefined : areas.get(name);
  return area !== undefined && hasRequirement(area, id);
}

async function planErrors(change: Change): Promise<string[]> {
  const [spec, plan] = await Promise.all([readSpec(change), readPlan(change)]);
  if (!spec.ok || !plan.ok) return [...errorsOf(spec), ...errorsOf(plan)];
  return consistencyErrors(plan.value, spec.value);
}

async function testsErrors(deps: Deps, change: Change, state: State, rules: Rules): Promise<string[]> {
  const [spec, trace] = await Promise.all([readSpec(change), readTrace(change)]);
  if (!spec.ok || !trace.ok) return [...errorsOf(spec), ...errorsOf(trace)];
  const unticked = state.size === "full" ? await untickedErrors(change, true) : [];
  const tier = await runFullTier(deps, rules);
  if (tier.errors.length) return [...unticked, ...tier.errors];
  const mode: TestMode = state.type === "refactor" || state.type === "chore" ? "pass" : state.built ? "after-build" : "fail-first";
  const rows = withStatuses(trace.value.rows, tier.cases, mode);
  await writeTrace(change, { ...trace.value, rows });
  return [...unticked, ...testsStageErrors(rows, spec.value, mode)];
}

async function buildErrors(deps: Deps, change: Change, state: State, rules: Rules): Promise<string[]> {
  const unticked = state.size === "full" ? await untickedErrors(change, false) : [];
  const tier = await runFullTier(deps, rules);
  if (tier.errors.length) return [...unticked, ...tier.errors];
  if (state.type === "docs") return [...unticked, ...failingCases(tier)];
  const trace = await readTrace(change);
  if (!trace.ok) return [...unticked, ...trace.errors];
  const rows = withVerdicts(withStatuses(trace.value.rows, tier.cases, "pass"), (path) => existsSync(join(deps.root, path)));
  await writeTrace(change, { ...trace.value, rows });
  return [...unticked, ...failingCases(tier), ...buildStageErrors(rows), ...(await mutationErrors(deps, rules))];
}

async function untickedErrors(change: Change, onlyTests: boolean): Promise<string[]> {
  const plan = await readPlan(change);
  if (!plan.ok) return plan.errors;
  return plan.value.filter((task) => !task.done && (!onlyTests || task.isTest)).map((task) => `Tick the task ${task.id} in plan.md when it is done.`);
}

async function mutationErrors(deps: Deps, rules: Rules): Promise<string[]> {
  if (!rules.mutation) return [];
  const result = await runCommand(rules.mutation, { cwd: deps.root, timeoutMs: deps.timeoutMs });
  if (result.code === 0) return [];
  return [
    `The mutation command failed (exit code ${result.code ?? "none"}): the score is below the minimum, or the command broke. Make the weak tests stronger. If a weak test is approved, use request_return with the stage tests. Output:\n${result.output.slice(-OUTPUT_TAIL)}`,
  ];
}
