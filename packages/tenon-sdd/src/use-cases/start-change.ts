import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { State } from "../entities/state.js";
import { changeOf, isoDate, writeState, type Change } from "./change.js";
import type { Deps } from "./ports.js";

const MAX_SLUG_WORDS = 5;
const FALLBACK_SLUG = "change";
const DATE_PREFIX_LENGTH = "YYYY-MM-DD-".length;

/** A short name from the request: lower case Latin letters and digits, at most 5 words. */
export function suggestSlug(request: string): string {
  const words = request.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  return words.slice(0, MAX_SLUG_WORDS).join("-") || FALLBACK_SLUG;
}

/** Make the branch and the change folder, write the first state.json, and commit it. */
export async function startChange(deps: Deps, { request, slug }: { request: string; slug: string }): Promise<Change> {
  const unique = await uniqueSlug(deps, slug);
  const folder = `${isoDate(deps.now())}-${unique}`;
  const base = await deps.git.currentBranch();
  await deps.git.createBranch(`sdd/${folder}`);
  const change = changeOf(deps.root, `sdd/${folder}`);
  if (!change) throw new Error(`The branch name sdd/${folder} is not valid.`);
  await mkdir(join(deps.root, change.dir), { recursive: true });
  const state: State = { owner: await deps.git.userName(), base, request, specVersion: 1, stage: "spec", reviewRounds: 0, gates: [] };
  await writeState(change, state);
  await deps.git.commitAll(`sdd(${unique}): start`);
  return change;
}

/** The slug, or the slug with -2, -3, … if a change folder or a branch already uses it. Test names start with the slug, so it must be unique. */
async function uniqueSlug(deps: Deps, slug: string): Promise<string> {
  const folders = await readdir(join(deps.root, "sdd/changes")).catch(() => []);
  const used = new Set(folders.map((name) => name.slice(DATE_PREFIX_LENGTH)));
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? slug : `${slug}-${n}`;
    if (!used.has(candidate) && !(await deps.git.branchExists(`sdd/*-${candidate}`))) return candidate;
  }
}
