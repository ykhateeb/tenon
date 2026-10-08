import type { TestLink } from "./area-spec.js";
import type { Spec } from "./delta.js";
import type { ParseResult } from "./result.js";

export type TestResult = "passed" | "failed" | "skipped";
export type TestCase = { name: string; className: string; result: TestResult };
export type Row = { id: string; scenario: string; level: string; test: string; status: string; evidence: string; verdict: string };
export type Traceability = { head: string[]; rows: Row[]; footer: string[] };
/** fail-first: a new test must fail before the build. after-build: the code of Build exists, so a test can pass or fail. pass: each test must pass. */
export type TestMode = "fail-first" | "after-build" | "pass";

export const REMOVED = "REMOVED";
export const CHARACTERIZATION = "Characterization";
export const EXPECTED_FAILURE = "failing (expected)";
const GONE = "—";
const COLUMNS = ["ID", "Scenario", "Level", "Test", "Status", "Evidence", "Verdict"];
const REQUIREMENT_ID = /^(?:NEW-[RQ]\d+|BASE-[RQ]\d+|[A-Z]{2,8}-[RQ]-\d{3,})$/;

export function parseTraceability(markdown: string): ParseResult<Traceability> {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => cells(line).join("|") === COLUMNS.join("|"));
  if (start < 0) return { ok: false, errors: [`traceability.md needs a table with the columns ${COLUMNS.join(" | ")}.`] };
  const first = start + (isSeparator(lines[start + 1] ?? "") ? 2 : 1);
  let end = first;
  while (end < lines.length && lines[end].trim().startsWith("|")) end++;
  return { ok: true, value: { head: lines.slice(0, start), rows: lines.slice(first, end).map((line) => toRow(cells(line))), footer: lines.slice(end) } };
}

export function renderTraceability(trace: Traceability): string {
  const line = (values: readonly string[]) => `| ${values.join(" | ")} |`;
  const rows = trace.rows.map((row) => line([row.id, row.scenario, row.level, row.test, row.status, row.evidence, row.verdict]));
  return [...trace.head, line(COLUMNS), `|${COLUMNS.map(() => "---").join("|")}|`, ...rows, ...trace.footer].join("\n");
}

/** The name part of the Test column that a JUnit test case must contain: the last path part of its first word. */
export function keyOf(row: Row): string {
  const word = row.test.split(/\s+/)[0] ?? "";
  return word.slice(word.lastIndexOf("/") + 1);
}

export function withStatuses(rows: readonly Row[], cases: readonly TestCase[], mode: TestMode): Row[] {
  return rows.map((row) => (row.verdict === "extra" ? row : { ...row, status: statusOf(row, cases, mode) }));
}

export function testsStageErrors(rows: readonly Row[], spec: Spec, mode: TestMode): string[] {
  const missing = [
    ...spec.scenarios.filter((scenario) => !rows.some((row) => row.scenario === scenario.id)).map((scenario) => `No row for the scenario ${scenario.id}.`),
    ...spec.delta.filter((item) => !rows.some((row) => row.id === item.id)).map((item) => `No row for ${item.id}.`),
  ];
  const wrong = rows.filter((row) => row.verdict !== "extra").flatMap((row) => {
    const wanted = wantedStatuses(row, mode);
    return wanted.includes(row.status) ? [] : [`${row.id} ${row.scenario}: ${row.test} is "${row.status}", and it must be "${wanted.join('" or "')}".`];
  });
  return [...missing, ...wrong];
}

export function withVerdicts(rows: readonly Row[], hasFile: (path: string) => boolean): Row[] {
  return rows.map((row) => {
    if (row.verdict === "extra") return row;
    if (row.scenario === REMOVED) return { ...row, verdict: GONE };
    const files = row.evidence.split(",").map((file) => file.trim()).filter(Boolean);
    const isMet = row.status === "passing" && files.length > 0 && files.every(hasFile);
    return { ...row, verdict: isMet ? "met" : "missing" };
  });
}

export function buildStageErrors(rows: readonly Row[]): string[] {
  return rows.flatMap((row) => {
    if (row.verdict === "extra") return [`Extra code with no requirement: ${row.evidence || row.test}. Remove it, or use request_return to add it to the spec.`];
    if (row.scenario === REMOVED) return row.status === GONE ? [] : [`The deleted test ${keyOf(row)} of REMOVED ${row.id} still runs.`];
    return row.verdict === "met" ? [] : [`${row.id} ${row.scenario}: the test is "${row.status}", and the evidence is "${row.evidence || "empty"}".`];
  });
}

/** The test links that Ship writes into the area specs. */
export function requirementLinks(rows: readonly Row[]): TestLink[] {
  return rows
    .filter((row) => REQUIREMENT_ID.test(row.id) && row.scenario !== REMOVED && row.verdict !== "extra" && keyOf(row) !== "")
    .map((row) => ({ id: row.id, test: keyOf(row) }));
}

function statusOf(row: Row, cases: readonly TestCase[], mode: TestMode): string {
  const key = keyOf(row);
  const found = key ? cases.filter((testCase) => testCase.name.includes(key) || testCase.className.includes(key)) : [];
  if (row.scenario === REMOVED) return found.length ? "still runs" : GONE;
  if (!found.length) return "not found";
  if (found.some((testCase) => testCase.result === "skipped")) return "skipped";
  if (!found.some((testCase) => testCase.result === "failed")) return "passing";
  return mode !== "pass" && row.level !== CHARACTERIZATION ? EXPECTED_FAILURE : "failing";
}

function wantedStatuses(row: Row, mode: TestMode): string[] {
  if (row.scenario === REMOVED) return [GONE];
  if (mode === "pass" || row.level === CHARACTERIZATION) return ["passing"];
  return mode === "after-build" ? ["passing", EXPECTED_FAILURE] : [EXPECTED_FAILURE];
}

function isSeparator(line: string): boolean {
  const values = cells(line);
  return values.length > 0 && values.every((value) => /^:?-+:?$/.test(value));
}

function cells(line: string): string[] {
  const text = line.trim();
  if (!text.startsWith("|")) return [];
  return text.slice(1, text.endsWith("|") ? -1 : undefined).split("|").map((cell) => cell.trim());
}

function toRow(values: readonly string[]): Row {
  const [id = "", scenario = "", level = "", test = "", status = "", evidence = "", verdict = ""] = values;
  return { id, scenario, level, test, status, evidence, verdict };
}
