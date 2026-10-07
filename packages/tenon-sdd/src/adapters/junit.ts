import { readFile, readdir, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { globBase, globToRegExp } from "../entities/glob.js";
import type { TestCase, TestResult } from "../entities/traceability.js";

const TESTCASE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };

/**
 * The test cases of a JUnit XML report.
 * ponytail: reads <testcase> elements with a regex, not a full XML parser. Use an XML library if a test tool writes JUnit that this cannot read.
 */
export function parseJunit(xml: string): TestCase[] {
  return [...xml.matchAll(TESTCASE)].map(([, attributes, body = ""]) => ({
    name: attribute(attributes, "name"),
    className: attribute(attributes, "classname"),
    result: resultOf(body),
  }));
}

export async function readReports(root: string, globs: readonly string[]): Promise<{ cases: TestCase[]; missing: string[] }> {
  const cases: TestCase[] = [];
  const missing: string[] = [];
  for (const glob of globs) {
    const files = await findFiles(root, glob);
    if (!files.length) missing.push(glob);
    for (const file of files) cases.push(...parseJunit(await readFile(join(root, file), "utf8")));
  }
  return { cases, missing };
}

export async function removeReports(root: string, globs: readonly string[]): Promise<void> {
  for (const glob of globs) {
    for (const file of await findFiles(root, glob)) await rm(join(root, file), { force: true });
  }
}

/** Files under the folder part of the glob that match it. A missing folder gives no files. */
async function findFiles(root: string, glob: string): Promise<string[]> {
  const pattern = globToRegExp(glob);
  const entries = await readdir(join(root, globBase(glob)), { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => pattern.test(path));
}

function resultOf(body: string): TestResult {
  if (/<(failure|error)\b/.test(body)) return "failed";
  if (/<skipped\b/.test(body)) return "skipped";
  return "passed";
}

function attribute(attributes: string, name: string): string {
  const value = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1] ?? "";
  return value.replace(/&(lt|gt|quot|apos|amp);/g, (_, entity: string) => ENTITIES[entity]);
}
