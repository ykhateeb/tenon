import type { BaselineItem, DeltaItem } from "./delta.js";
import { parsed, type ParseResult } from "./result.js";

export type Requirement = { id: string; text: string; since: string; was: string | undefined };
export type TestLink = { id: string; test: string };
export type AreaSpec = {
  title: string;
  prefix: string;
  nextR: number;
  nextQ: number;
  coverage: string[];
  behavior: Requirement[];
  quality: Requirement[];
  tests: TestLink[];
  history: string[];
};
export type AreaChange = {
  folder: string;
  delta: readonly DeltaItem[];
  baseline: readonly BaselineItem[];
  coverage: string | undefined;
  tests: readonly TestLink[];
};

const TITLE = /^# Area spec: (.+)$/;
const HEADER = /^Prefix: ([A-Z]{2,8})\s+Next IDs: [A-Z]{2,8}-R-(\d+), [A-Z]{2,8}-Q-(\d+)$/;
const REQUIREMENT_LINE = /^- ([A-Z]{2,8}-[RQ]-\d{3,}): (.+?)\s+\(since ([^;)]+)(?:; was: (.*))?\)$/;
const TEST_LINE = /^- ([A-Z]{2,8}-[RQ]-\d{3,}) → (.+)$/;
const LIST_LINE = /^- (.+)$/;
const FINAL_ID = /^[A-Z]{2,8}-[RQ]-\d{3,}$/;
const QUALITY_LOCAL_ID = /^(?:NEW|BASE)-Q\d+$/;

type SectionReader = { pattern: RegExp; kind: string; add: (area: AreaSpec, match: RegExpExecArray) => void };
/** The sections of an area spec, and how each reads its lines. */
const SECTIONS = new Map<string, SectionReader>([
  ["Coverage", { pattern: LIST_LINE, kind: "coverage line", add: (area, [, text]) => area.coverage.push(text) }],
  ["Current behavior", { pattern: REQUIREMENT_LINE, kind: "requirement line", add: (area, match) => area.behavior.push(toRequirement(match)) }],
  ["Quality requirements", { pattern: REQUIREMENT_LINE, kind: "requirement line", add: (area, match) => area.quality.push(toRequirement(match)) }],
  ["Tests", { pattern: TEST_LINE, kind: "test link", add: (area, [, id, test]) => area.tests.push({ id, test }) }],
  ["History", { pattern: LIST_LINE, kind: "history line", add: (area, [, text]) => area.history.push(text) }],
]);

export function newArea(name: string, prefix: string): AreaSpec {
  const title = name.charAt(0).toUpperCase() + name.slice(1).replaceAll("-", " ");
  return { title, prefix, nextR: 1, nextQ: 1, coverage: [], behavior: [], quality: [], tests: [], history: [] };
}

export function isFinalId(id: string): boolean {
  return FINAL_ID.test(id);
}

export function hasRequirement(area: AreaSpec, id: string): boolean {
  return [...area.behavior, ...area.quality].some((requirement) => requirement.id === id);
}

export function parseAreaSpec(markdown: string): ParseResult<AreaSpec> {
  const area = newArea("area", "");
  area.title = "";
  let section = "";
  const errors: string[] = [];
  const lines = markdown.split(/\r?\n/).map((text) => text.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ")) {
      const newSection = line.slice(3);
      if (!SECTIONS.has(newSection)) {
        errors.push(`area spec line ${i + 1}: an area spec has only the sections Coverage, Current behavior, Quality requirements, Tests, and History.`);
      }
      section = newSection;
    } else {
      readAreaLine(area, section, line, i + 1, errors);
    }
  }

  const initialErrors = [
    ...(area.title ? [] : ['An area spec starts with "# Area spec: <title>".']),
    ...(area.prefix ? [] : ['An area spec needs the line "Prefix: ABC   Next IDs: ABC-R-001, ABC-Q-001".']),
  ];
  return parsed(area, [...initialErrors, ...errors]);
}

export function renderAreaSpec(area: AreaSpec): string {
  const requirement = (r: Requirement) => `- ${r.id}: ${r.text}  (since ${r.since}${r.was ? `; was: ${r.was}` : ""})`;
  return [
    `# Area spec: ${area.title}`,
    `Prefix: ${area.prefix}   Next IDs: ${area.prefix}-R-${pad(area.nextR)}, ${area.prefix}-Q-${pad(area.nextQ)}`,
    ...(area.coverage.length ? ["", "## Coverage", ...area.coverage.map((text) => `- ${text}`)] : []),
    "",
    "## Current behavior",
    ...area.behavior.map(requirement),
    "",
    "## Quality requirements",
    ...area.quality.map(requirement),
    "",
    "## Tests",
    ...area.tests.map((link) => `- ${link.id} → ${link.test}`),
    "",
    "## History",
    ...area.history.map((line) => `- ${line}`),
    "",
  ].join("\n");
}

/** MODIFIED and REMOVED items whose text in the area spec is not what the delta expects. */
export function staleErrors(area: AreaSpec, items: readonly DeltaItem[]): string[] {
  const current = new Map([...area.behavior, ...area.quality].map((requirement) => [requirement.id, requirement.text]));
  return items.flatMap((item) => {
    if (item.op === "ADDED" || item.id.startsWith("BASE-")) return [];
    const expected = item.op === "MODIFIED" ? item.was : item.text;
    const actual = current.get(item.id);
    if (actual === undefined) return [`${item.id} is not in the area spec any more.`];
    return actual === expected ? [] : [`${item.id} changed in the area spec: it says "${actual}", and the delta expects "${expected}".`];
  });
}

/** Apply one change to an area spec: baseline, delta, test links, and one history line. */
export function applyChange(area: AreaSpec, change: AreaChange): { area: AreaSpec; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  let { nextR, nextQ } = area;
  const assign = (localId: string): string => {
    const isQuality = QUALITY_LOCAL_ID.test(localId);
    const id = `${area.prefix}-${isQuality ? "Q" : "R"}-${pad(isQuality ? nextQ++ : nextR++)}`;
    ids.set(localId, id);
    return id;
  };
  const resolve = (id: string) => ids.get(id) ?? id;
  const requirements = new Map([...area.behavior, ...area.quality].map((requirement) => [requirement.id, requirement]));
  for (const item of change.baseline) {
    const id = assign(item.id);
    requirements.set(id, { id, text: item.text, since: `${change.folder}, baseline`, was: undefined });
  }
  for (const item of change.delta) {
    if (item.op === "ADDED") {
      const id = assign(item.id);
      requirements.set(id, { id, text: item.text, since: change.folder, was: undefined });
    } else if (item.op === "MODIFIED") {
      const id = resolve(item.id);
      requirements.set(id, { id, text: item.text, since: change.folder, was: requirements.get(id)?.text });
    } else requirements.delete(resolve(item.id));
  }
  const modified = new Set(change.delta.filter((item) => item.op === "MODIFIED").map((item) => resolve(item.id)));
  const links = change.tests.map((link) => ({ id: resolve(link.id), test: link.test }));
  const sorted = [...requirements.values()].sort((a, b) => compareText(a.id, b.id));
  const history = historyLine(change, resolve);
  return {
    ids,
    area: {
      ...area,
      nextR,
      nextQ,
      coverage: change.coverage ? [change.coverage] : area.coverage,
      behavior: sorted.filter((requirement) => requirement.id.includes("-R-")),
      quality: sorted.filter((requirement) => requirement.id.includes("-Q-")),
      tests: linkTests(area.tests, links, modified, requirements),
      history: history ? [history, ...area.history] : area.history,
    },
  };
}

function readAreaLine(area: AreaSpec, section: string, line: string, lineNum: number, errors: string[]): void {
  const title = TITLE.exec(line);
  if (title) area.title = title[1];
  const header = HEADER.exec(line);
  if (header) {
    area.prefix = header[1];
    area.nextR = Number(header[2]);
    area.nextQ = Number(header[3]);
  }
  const reader = SECTIONS.get(section);
  const match = reader?.pattern.exec(line);
  if (reader && match) reader.add(area, match);
  else if (reader && line) errors.push(`area spec line ${lineNum}: this is not a ${reader.kind}: "${line}".`);
  else if (section === "" && line && !title && !header) errors.push(`area spec line ${lineNum}: this text is before the first section: "${line}".`);
}

function toRequirement([, id, text, since, was]: RegExpExecArray): Requirement {
  return { id, text, since, was };
}

/** Old links stay, except the links of a MODIFIED requirement that has new links. Links of a removed requirement go. */
function linkTests(old: readonly TestLink[], added: readonly TestLink[], modified: ReadonlySet<string>, requirements: ReadonlyMap<string, Requirement>): TestLink[] {
  const relinked = new Set(added.filter((link) => modified.has(link.id)).map((link) => link.id));
  return [...old.filter((link) => !relinked.has(link.id)), ...added]
    .filter((link) => requirements.has(link.id))
    .filter((link, index, all) => all.findIndex((other) => other.id === link.id && other.test === link.test) === index)
    .sort((a, b) => compareText(a.id, b.id) || compareText(a.test, b.test));
}

function historyLine(change: AreaChange, resolve: (id: string) => string): string | undefined {
  const named = (op: DeltaItem["op"]) => change.delta.filter((item) => item.op === op).map((item) => resolve(item.id));
  const parts = [
    listed("baseline", change.baseline.map((item) => resolve(item.id))),
    listed("ADDED", named("ADDED")),
    listed("MODIFIED", named("MODIFIED")),
    listed("REMOVED", named("REMOVED")),
  ].filter(Boolean);
  if (!parts.length && change.tests.length) parts.push(listed("tests for", [...new Set(change.tests.map((link) => resolve(link.id)))]));
  return parts.length ? `${change.folder}: ${parts.join("; ")}` : undefined;
}

function listed(label: string, ids: readonly string[]): string {
  return ids.length ? `${label} ${ids.join(", ")}` : "";
}

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

/** A plain comparison: localeCompare can ignore hyphens in some locales, and IDs must sort the same everywhere. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
