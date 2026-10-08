import { parsed, type ParseResult } from "./result.js";
import type { ChangeType, State } from "./state.js";

export type Story = { id: string; title: string; priority: number };
export type Scenario = { id: string; story: string; text: string };
export type DeltaItem =
  | { op: "ADDED"; area: string; id: string; text: string }
  | { op: "MODIFIED"; area: string; id: string; text: string; was: string }
  | { op: "REMOVED"; area: string; id: string; text: string; why: string };
export type BaselineItem = { area: string; id: string; text: string; intended: boolean; defect: string | undefined };
export type NewArea = { area: string; prefix: string };
export type Coverage = { area: string; text: string };
export type Spec = {
  stories: Story[];
  scenarios: Scenario[];
  delta: DeltaItem[];
  baseline: BaselineItem[];
  newAreas: NewArea[];
  coverage: Coverage[];
  openQuestions: string[];
  requirement: string | undefined;
};

const STORY = /^### (US\d+) — (.+) \(P(\d+)\)$/;
const SCENARIO = /^- \[(US\d+)-(S\d+)\] (.+)$/;
const AREA = /^### sdd\/areas\/([a-z0-9-]+)\.md(?: \(new, prefix ([A-Z]{2,8})\))?$/;
const DELTA_ITEM = /^- (ADDED|MODIFIED|REMOVED)\s+(\S+): (.+)$/;
const BASELINE_ITEM = /^- (BASE-[RQ]\d+): (.+)$/;
const COVERAGE = /^Coverage: (.+)$/;
const WAS = /^\(was: (.+)\)$/;
const WHY = /^\(why: (.+)\)$/;
const OPEN = /^- \[OPEN\] (.+)$/;
const REQUIREMENT = /(?:^|\s)Requirement: ([A-Z]{2,8}-[RQ]-\d{3,})(?:\s|$)/;
const NEW_ID = /^NEW-[RQ]\d+$/;
const EXISTING_ID = /^(?:[A-Z]{2,8}-[RQ]-\d{3,}|BASE-[RQ]\d+)$/;
const DELTA = "## Delta";
const BASELINE = "## Baseline (from code)";
const EMPTY_DELTA_TYPES: readonly ChangeType[] = ["bug", "refactor", "chore", "docs"];

type Line = { text: string; next: string; at: string };

/** Parse the strict lines of spec.md. All other text is prose. */
export function parseSpec(markdown: string): ParseResult<Spec> {
  const spec: Spec = { stories: [], scenarios: [], delta: [], baseline: [], newAreas: [], coverage: [], openQuestions: [], requirement: undefined };
  const errors: string[] = [];
  const texts = markdown.split(/\r?\n/).map((line) => line.trim());
  let section = "";
  let area: string | undefined;
  texts.forEach((text, index) => {
    if (text.startsWith("## ")) {
      section = text;
      area = undefined;
      return;
    }
    const at = `spec.md line ${index + 1}`;
    const line: Line = { text, next: texts[index + 1] ?? "", at };
    const newArea = readAreaHeading(spec, errors, line);
    if (newArea !== undefined) {
      area = newArea;
    } else if ((section === DELTA || section === BASELINE) && text.startsWith("### ")) {
      errors.push(`${at}: an area heading looks like "### sdd/areas/<area>.md" or "### sdd/areas/<area>.md (new, prefix ABC)".`);
      area = undefined;
    }
    readCommonLine(spec, text);
    if (section === DELTA) readDeltaLine(spec, errors, line, area);
    if (section === BASELINE) readBaselineLine(spec, errors, line, area);
  });
  return parsed(spec, [...errors, ...crossErrors(spec)]);
}

/** The rules that the type and the size put on the spec. */
export function sizeErrors(spec: Spec, { size, type }: Pick<State, "size" | "type">): string[] {
  if (!size || !type) return ["Call classify_change to set the type and the size of the change."];
  const errors: string[] = [];
  if (type === "feature" && size === "small") errors.push("A feature is always full size.");
  if (EMPTY_DELTA_TYPES.includes(type) && spec.delta.length) errors.push(`A ${type} has an empty delta.`);
  if (size === "small" && !isSmallDelta(spec.delta)) errors.push("A small change has an empty delta or one MODIFIED item.");
  if (size === "small" && (type === "bug" || type === "change") && !spec.requirement) errors.push(`A small ${type} needs the line "Requirement: <ID>".`);
  return errors;
}

function readAreaHeading(spec: Spec, errors: string[], { text, at }: Line): string | undefined {
  const match = AREA.exec(text);
  if (!match) return undefined;
  const [, area, prefix] = match;
  const known = spec.newAreas.find((item) => item.area === area);
  if (prefix && !known) spec.newAreas.push({ area, prefix });
  if (prefix && known && known.prefix !== prefix) errors.push(`${at}: the new area ${area} has the prefix ${known.prefix}, not ${prefix}.`);
  return area;
}

function readCommonLine(spec: Spec, text: string): void {
  const requirement = REQUIREMENT.exec(text);
  if (requirement) spec.requirement = requirement[1];
  const open = OPEN.exec(text);
  if (open) spec.openQuestions.push(open[1]);
  const story = STORY.exec(text);
  if (story) spec.stories.push({ id: story[1], title: story[2], priority: Number(story[3]) });
  const scenario = SCENARIO.exec(text);
  if (scenario) spec.scenarios.push({ id: `${scenario[1]}-${scenario[2]}`, story: scenario[1], text: scenario[3] });
}

function readDeltaLine(spec: Spec, errors: string[], { text, next, at }: Line, area: string | undefined): void {
  const match = DELTA_ITEM.exec(text);
  if (!match) {
    if (text.startsWith("- ") && !OPEN.test(text)) {
      errors.push(`${at}: a delta item looks like "- ADDED NEW-R1: <text>", "- MODIFIED <ID>: <text>", or "- REMOVED <ID>: <text>".`);
    }
    return;
  }
  const [, op, id, itemText] = match;
  if (!area) {
    errors.push(`${at}: put a "### sdd/areas/<area>.md" heading above the delta item ${id}.`);
    return;
  }
  if (op === "ADDED") {
    if (!NEW_ID.test(id)) errors.push(`${at}: an ADDED ID looks like NEW-R1 or NEW-Q1, not ${id}.`);
    spec.delta.push({ op: "ADDED", area, id, text: itemText });
    return;
  }
  if (!EXISTING_ID.test(id)) errors.push(`${at}: a ${op} ID looks like FAV-R-002 or BASE-R1, not ${id}.`);
  if (op === "MODIFIED") {
    const was = WAS.exec(next);
    if (!was) errors.push(`${at}: put a "(was: …)" line below MODIFIED ${id}.`);
    spec.delta.push({ op: "MODIFIED", area, id, text: itemText, was: was?.[1] ?? "" });
    return;
  }
  const why = WHY.exec(next);
  if (!why) errors.push(`${at}: put a "(why: …)" line below REMOVED ${id}.`);
  spec.delta.push({ op: "REMOVED", area, id, text: itemText, why: why?.[1] ?? "" });
}

function readBaselineLine(spec: Spec, errors: string[], { text, next, at }: Line, area: string | undefined): void {
  const coverage = COVERAGE.exec(text);
  if (coverage && area) spec.coverage.push({ area, text: coverage[1] });
  const match = BASELINE_ITEM.exec(text);
  if (!match) {
    if (text.startsWith("- ") && !OPEN.test(text)) {
      errors.push(`${at}: a baseline item looks like "- BASE-R1: <text>".`);
    }
    return;
  }
  const [, id, itemText] = match;
  if (!area) {
    errors.push(`${at}: put a "### sdd/areas/<area>.md" heading above the baseline item ${id}.`);
    return;
  }
  const intended = /Intended\? yes/.test(next) ? true : /Intended\? no/.test(next) ? false : undefined;
  if (intended === undefined) errors.push(`${at}: put "Intended? yes" or "Intended? no" below ${id}.`);
  const defect = /Defect: (.+?)(?:\s+Intended\?.*)?$/.exec(next)?.[1];
  spec.baseline.push({ area, id, text: itemText, intended: intended ?? true, defect });
}

function crossErrors(spec: Spec): string[] {
  const stories = new Set(spec.stories.map((story) => story.id));
  return [
    ...duplicates(spec.stories.map((story) => story.id)).map((id) => `The story ${id} is in spec.md more than one time.`),
    ...duplicates(spec.delta.map((item) => item.id)).map((id) => `The delta names ${id} more than one time.`),
    ...duplicates(spec.scenarios.map((scenario) => scenario.id)).map((id) => `The scenario ${id} is in spec.md more than one time.`),
    ...spec.scenarios.filter((scenario) => !stories.has(scenario.story)).map((scenario) => `The scenario ${scenario.id} has no story ${scenario.story}.`),
  ];
}

function duplicates(values: readonly string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function isSmallDelta(delta: readonly DeltaItem[]): boolean {
  return delta.length === 0 || (delta.length === 1 && delta[0].op === "MODIFIED");
}
