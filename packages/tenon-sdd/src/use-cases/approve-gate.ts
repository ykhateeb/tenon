import { matchesAny } from "../entities/glob.js";
import type { Rules } from "../entities/rules.js";
import { approvalOf, GATES, withApproval, type Gate, type State } from "../entities/state.js";
import { AREAS_DIR, isoDate, pathOf, readText, writeState, type Change } from "./change.js";
import type { Deps } from "./ports.js";

export const GATE_QUESTIONS: Record<Gate, string> = {
  G1: "Is this the right thing to build?",
  G2: "Is this the right way to build it, and do the tests truly express the spec?",
  G3: "Is the final diff, the area specs included, correct and good code to keep?",
};

/** Commit all work, record the approval with that commit, then commit state.json. */
export async function recordApproval(deps: Deps, change: Change, gate: Gate, state: State): Promise<State> {
  const commit = (await deps.git.commitAll(`sdd(${change.slug}): ${gate} approved`)) ?? (await deps.git.head());
  const approved = withApproval(state, { gate, commit, by: await deps.git.userName(), at: isoDate(deps.now()) });
  await writeState(change, approved);
  await deps.git.commitAll(`sdd(${change.slug}): record ${gate}`);
  return approved;
}

/** The approved tests: test files that the branch changed up to the G2 approval. */
export async function lockedTests(deps: Deps, state: State, rules: Rules): Promise<string[]> {
  const approval = approvalOf(state, "G2");
  return approval ? testFilesChanged(deps, state, rules, approval.commit) : [];
}

/** Approved gates with a covered file that changed after the approval, earliest first. */
export async function invalidGates(deps: Deps, change: Change, state: State, rules: Rules): Promise<Gate[]> {
  const invalid: Gate[] = [];
  for (const gate of GATES) {
    const approval = approvalOf(state, gate);
    if (!approval) continue;
    const covered = await coveredPaths(deps, change, state, rules, gate, approval.commit);
    if ((await deps.git.changedSince(approval.commit, covered)).length) invalid.push(gate);
  }
  return invalid;
}

/** The text that the person reads before a gate. */
export async function gateSummary(deps: Deps, change: Change, gate: Gate, state: State, rules: Rules): Promise<string> {
  const file = async (path: string) => `### ${path}\n\n${(await readText(deps.root, path)) ?? "(missing)"}`;
  const parts = [`## ${gate} · ${change.slug}`, `**${GATE_QUESTIONS[gate]}**`];
  if (gate === "G1") parts.push(await file(pathOf(change, "spec.md")));
  if (gate === "G2") parts.push(await file(pathOf(change, "plan.md")), await file(pathOf(change, "traceability.md")), testList(await testFilesChanged(deps, state, rules, "HEAD")));
  if (gate === "G3") {
    if (state.size === "small") parts.push(await file(pathOf(change, "spec.md")), await file(pathOf(change, "traceability.md")));
    const from = await deps.git.forkPoint(state.base);
    parts.push(await file(pathOf(change, "outcome.md")), fenced("Area spec changes", "diff", await deps.git.diff(from, [AREAS_DIR])), fenced("Files", "", await deps.git.diffStat(from)));
  }
  return parts.join("\n\n");
}

/** G1 covers spec.md. G2 covers spec.md and the approved tests. G3 covers each file that the branch changed, except state.json. */
async function coveredPaths(deps: Deps, change: Change, state: State, rules: Rules, gate: Gate, commit: string): Promise<string[]> {
  if (gate === "G1") return [pathOf(change, "spec.md")];
  if (gate === "G2") return [pathOf(change, "spec.md"), ...(await testFilesChanged(deps, state, rules, commit))];
  const from = await deps.git.forkPoint(state.base, commit);
  return (await deps.git.changedBetween(from, commit)).filter((path) => path !== pathOf(change, "state.json"));
}

async function testFilesChanged(deps: Deps, state: State, rules: Rules, to: string): Promise<string[]> {
  const from = await deps.git.forkPoint(state.base, to);
  return (await deps.git.changedBetween(from, to)).filter((path) => matchesAny(path, rules.testFiles));
}

function testList(paths: readonly string[]): string {
  return `### Tests to approve\n\n${paths.length ? paths.map((path) => `- ${path}`).join("\n") : "- none"}`;
}

function fenced(title: string, language: string, body: string): string {
  return `### ${title}\n\n\`\`\`${language}\n${body || "(no changes)"}\n\`\`\``;
}
