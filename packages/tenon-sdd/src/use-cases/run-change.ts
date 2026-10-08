import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertSection } from "../entities/markdown.js";
import { parseRules, type Rules } from "../entities/rules.js";
import { approvalOf, gateAfter, nextStage, parseState, stageOf, type State } from "../entities/state.js";
import type { Policy, StageKind } from "../entities/write-policy.js";
import { GATE_QUESTIONS, gateSummary, invalidGates, lockedTests, recordApproval } from "./approve-gate.js";
import { changeOf, pathOf, readRules, readSpec, readState, readText, RULES_PATH, writeState, type Change } from "./change.js";
import { exitErrors, shipErrors } from "./exit-checks.js";
import type { Deps, Finding, ReturnStage, StageRun } from "./ports.js";
import { returnChange } from "./return-change.js";
import { protectedErrors, redraft, runChecked, type StageEnd } from "./run-stage.js";
import { rulesApprovedSubject, setupRules } from "./setup-rules.js";
import { shipApply } from "./ship-apply.js";
import { GUIDES } from "./stages.js";
import { startChange, suggestSlug } from "./start-change.js";

const MAX_REVIEW_ROUNDS = 2;
const RETURN_ORDER: readonly ReturnStage[] = ["spec", "plan", "tests", "build"];

type Step = { kind: "stopped" } | { kind: "next"; state: State };
type Checked = { kind: "passed"; state: State; findings: Finding[] | undefined } | Exclude<StageEnd, { kind: "passed" }>;
type Reviewed = { kind: "reviewed"; state: State; findings: Finding[] };
type Check = (latest: State, findings: Finding[] | undefined) => Promise<string[]>;

const STOPPED: Step = { kind: "stopped" };

/** The /sdd runner: start a change from a request, or continue the change of the current branch. */
export function createRunner(deps: Deps) {
  return {
    start: (request: string) => start(deps, request),
    resume: () => resume(deps),
  };
}

async function start(deps: Deps, request: string): Promise<void> {
  const refusal = await startRefusal(deps);
  if (refusal) return deps.person.notify(refusal, "warning");
  const suggestion = suggestSlug(request);
  const answer = await deps.person.input(`Short name for this change. Leave it empty to use "${suggestion}".`, suggestion);
  if (answer === undefined) return;
  const change = await startChange(deps, { request, slug: answer.trim() ? suggestSlug(answer) : suggestion });
  await drive(deps, change, false);
}

async function resume(deps: Deps): Promise<void> {
  const refusal = await repositoryRefusal(deps);
  if (refusal) return deps.person.notify(refusal, "warning");
  if (await deps.git.isMerging()) return deps.person.notify("Finish the merge first: resolve the conflicts and commit. Then run /sdd again.", "warning");
  const change = changeOf(deps.root, await deps.git.currentBranch());
  if (!change || (await readText(deps.root, pathOf(change, "state.json"))) === undefined) {
    return deps.person.notify("No change runs on this branch. Run /sdd <request> to start one, or switch to its sdd/ branch.", "warning");
  }
  await drive(deps, change, true);
}

async function repositoryRefusal(deps: Deps): Promise<string | undefined> {
  if (!(await deps.git.isRepository())) return "/sdd needs a git repository.";
  if ((await realpath(await deps.git.root())) !== (await realpath(deps.root))) return "Run /sdd from the root folder of the git repository.";
  return undefined;
}

async function startRefusal(deps: Deps): Promise<string | undefined> {
  const refusal = await repositoryRefusal(deps);
  if (refusal) return refusal;
  if ((await deps.git.currentBranch()) === "") return "Switch to a branch first. /sdd does not run on a detached HEAD.";
  if (!(await deps.git.isClean())) return "Commit or stash your work first. /sdd needs a clean working tree.";
  if ((await deps.git.currentBranch()).startsWith("sdd/")) return "A change already runs on this branch. Run /sdd with no request to continue it.";
  return undefined;
}

/** Run the stages until the change is done, the person stops it, or a merge conflict needs the person. */
async function drive(deps: Deps, change: Change, resumed: boolean): Promise<void> {
  let state = resumed ? await committedState(deps, change) : await readState(change);
  if ((await isSetupPending(deps, change)) && (await setupRules(deps, change, state)) === "stopped") return;
  let resume = resumed ? await restoreOnResume(deps, change, state) : undefined;
  if (resumed) {
    if (!(await mergedBase(deps, state))) return;
    state = await reopenInvalidGates(deps, change, state);
  }
  while (state.stage !== "done") {
    if (!resume && !(await mergedBase(deps, state))) return;
    if (state.stage === "ship") for (const line of resume ?? []) deps.person.notify(line, "warning");
    const step = state.stage === "ship" ? await ship(deps, change, state, resume !== undefined) : await workStage(deps, change, state, resume);
    resume = undefined;
    if (step.kind === "stopped") return;
    state = step.state;
  }
  deps.person.notify(`The change is ready. Merge the branch sdd/${change.folder} into ${state.base}.`, "info");
}

/**
 * Setup is pending until the commit "rules approved" holds sdd/rules.md. A rules draft that the person did not approve is committed too.
 * Rules from the base branch, from another change, or from a merge are not pending.
 */
async function isSetupPending(deps: Deps, change: Change): Promise<boolean> {
  if (!(await deps.git.isCommitted(RULES_PATH))) return true;
  const subject = await deps.git.subjectOf("HEAD", RULES_PATH);
  return subject.startsWith(`sdd(${change.slug}): `) && subject !== rulesApprovedSubject(change);
}

// ponytail: trusts git history. A stage with bash can commit a forged state.json and stop the app before the runner checks; read the branch diff before you merge.
/**
 * The state of the last commit. The working tree of an interrupted run is not trusted:
 * a session could have written state.json through bash.
 */
async function committedState(deps: Deps, change: Change): Promise<State> {
  const result = parseState((await deps.git.fileAt("HEAD", pathOf(change, "state.json"))) ?? "");
  if (!result.ok) throw new Error(`state.json in the last commit is not valid: ${result.errors.join(" ")}`);
  return result.value;
}

/** The rules of the last commit: the working tree is not trusted before the protected files are restored. */
async function committedRules(deps: Deps): Promise<Rules> {
  const result = parseRules((await deps.git.fileAt("HEAD", RULES_PATH)) ?? "");
  if (!result.ok) throw new Error(`${RULES_PATH} in the last commit is not valid: ${result.errors.join(" ")}`);
  return result.value;
}

/** Restore the protected files of the interrupted session, then commit what is left, so that the merge can run. */
async function restoreOnResume(deps: Deps, change: Change, state: State): Promise<string[]> {
  const rules = await committedRules(deps);
  const restored = await protectedErrors(deps, change, await policyOf(deps, change, state, rules), state, await deps.git.head());
  await deps.git.commitAll(`sdd(${change.slug}): resume`);
  return restored;
}

/** Spec, Plan, Tests, or Build: the sessions, the exit check, then the gate or the next stage. A resume holds the lines about the files that the runner restored. */
async function workStage(deps: Deps, change: Change, state: State, resume: readonly string[] | undefined): Promise<Step> {
  const rules = await readRules(deps.root);
  const check: Check = (latest) => exitErrors(deps, change, latest, rules);
  let current = state;
  const hasPassed = resume?.length === 0 && (await check(state, undefined)).length === 0;
  if (!hasPassed) {
    const runs = resume ? [await stageRun(deps, change, state, rules, state.stage, ["Continue the stage. Read the files to see what is done.", ...resume])] : await stageRuns(deps, change, state, rules);
    const checked = await checkedStage(deps, change, state, runs, check);
    if (checked.kind !== "passed") return endOf(deps, change, checked);
    current = checked.state;
  }
  current = await withReturnDone(change, current);
  await deps.git.commitAll(`sdd(${change.slug}): ${current.stage} passed`);
  return gateOrAdvance(deps, change, current, rules);
}

async function stageRuns(deps: Deps, change: Change, state: State, rules: Rules): Promise<StageRun[]> {
  if (state.stage !== "build" || state.size === "small") return [await stageRun(deps, change, state, rules, state.stage, [])];
  const spec = await readSpec(change);
  const stories = spec.ok ? [...spec.value.stories].sort((a, b) => a.priority - b.priority) : [];
  const storyRuns = await Promise.all(stories.map((story) => stageRun(deps, change, state, rules, `build ${story.id}`, [`Part: the story ${story.id} — ${story.title}.`])));
  return [
    await stageRun(deps, change, state, rules, "build foundation", ["Part: the foundation tasks."]),
    ...storyRuns,
    await stageRun(deps, change, state, rules, "build check", ["Part: the check."]),
  ];
}

async function stageRun(deps: Deps, change: Change, state: State, rules: Rules, title: string, lines: readonly string[]): Promise<StageRun> {
  const policy = await policyOf(deps, change, state, rules);
  const message = [
    `Read ${join(deps.guidesDir, GUIDES[policy.kind])} and follow it.`,
    `Change folder: ${change.dir}`,
    `Rules: ${RULES_PATH}`,
    ...(state.stage === "spec" ? [`Request: ${state.request}`] : []),
    ...(state.returned?.stage === state.stage ? [`Returned to this stage: ${state.returned.reason}`] : []),
    ...lines,
  ].join("\n");
  return { title: `sdd: ${title} (${change.slug})`, message, policy };
}

async function policyOf(deps: Deps, change: Change, state: State, rules: Rules): Promise<Policy> {
  return {
    kind: kindOf(state.stage),
    changeDir: change.dir,
    specLocked: approvalOf(state, "G1") !== undefined,
    lockedTests: await lockedTests(deps, state, rules),
    testGlobs: rules.testFiles,
  };
}

function kindOf(stage: State["stage"]): StageKind {
  return stage === "ship" || stage === "done" ? "review" : stage;
}

/** Run the sessions with the retry loop. A classification from the agent goes into state.json at once. */
async function checkedStage(deps: Deps, change: Change, state: State, runs: readonly StageRun[], check: Check): Promise<Checked> {
  let current = state;
  let findings: Finding[] | undefined;
  const since = await deps.git.head();
  const end = await runChecked(deps, {
    runs,
    protect: () => protectedErrors(deps, change, runs[0].policy, current, since),
    apply: async (outcome) => {
      if (outcome.classification) {
        current = { ...current, ...outcome.classification };
        await writeState(change, current);
      }
      if (outcome.findings) findings = outcome.findings;
    },
    check: () => check(current, findings),
  });
  return end.kind === "passed" ? { kind: "passed", state: current, findings } : end;
}

async function endOf(deps: Deps, change: Change, end: Exclude<Checked, { kind: "passed" }>): Promise<Step> {
  if (end.kind === "stopped") return STOPPED;
  return { kind: "next", state: await returnChange(deps, change, await readState(change), end.request) };
}

async function gateOrAdvance(deps: Deps, change: Change, state: State, rules: Rules): Promise<Step> {
  const gate = gateAfter(state.stage, state.size);
  if (!gate) return { kind: "next", state: await advance(deps, change, state) };
  let current = state;
  for (;;) {
    const reviewedHead = await deps.git.head();
    const answer = await deps.person.gate(`${gate}: ${GATE_QUESTIONS[gate]}`, await gateSummary(deps, change, gate, current, rules));
    if (answer.kind === "stop") return STOPPED;
    if (answer.kind === "approve") {
      const approved = await recordApproval(deps, change, gate, current, reviewedHead);
      if (approved) return { kind: "next", state: await advance(deps, change, approved) };
      await redraft(deps, change, await policyOf(deps, change, current, rules), current, reviewedHead);
      continue;
    }
    const run = await stageRun(deps, change, current, rules, `${current.stage} change`, [`The person asked for this change at ${gate}: ${answer.feedback}`]);
    const checked = await checkedStage(deps, change, current, [run], (latest) => exitErrors(deps, change, latest, rules));
    if (checked.kind !== "passed") return endOf(deps, change, checked);
    current = checked.state;
    await deps.git.commitAll(`sdd(${change.slug}): ${current.stage} changed at ${gate}`);
  }
}

/** The stage of the last return passed its exit check, so its sessions no longer get the reason. */
async function withReturnDone(change: Change, state: State): Promise<State> {
  if (state.returned?.stage !== state.stage) return state;
  const done: State = { ...state, returned: undefined };
  await writeState(change, done);
  return done;
}

async function advance(deps: Deps, change: Change, state: State): Promise<State> {
  const stage = nextStage(state);
  const next: State = stage === "build" ? { ...state, stage, built: true } : { ...state, stage };
  await writeState(change, next);
  await deps.git.commitAll(`sdd(${change.slug}): start ${next.stage}`);
  return next;
}

/** Ship: apply the delta, review, return for findings (at most 2 rounds), then G3. A resume at a finished review goes to G3. */
async function ship(deps: Deps, change: Change, state: State, resumed: boolean): Promise<Step> {
  const rules = await readRules(deps.root);
  const applied = await shipApply(deps, change, state);
  if (applied.errors.length) {
    return { kind: "next", state: await returnChange(deps, change, state, { stage: "spec", reason: `The delta is stale: ${applied.errors.join(" ")}` }) };
  }
  await deps.git.commitAll(`sdd(${change.slug}): apply the delta to the area specs`);
  if (resumed && (await isReviewDone(deps, change, rules))) return shipGate(deps, change, state, rules, applied.ids);
  const review = await reviewRound(deps, change, state, rules, applied.ids, []);
  if (review.kind !== "reviewed") return review;
  if (review.findings.length && review.state.reviewRounds < MAX_REVIEW_ROUNDS) return returnForFindings(deps, change, review.state, review.findings);
  return shipGate(deps, change, review.state, rules, applied.ids);
}

/** The runner commits "review" right after a review round, and a redraft at G3 commits "files changed at the gate". At either commit, the last review covers the content. */
async function isReviewDone(deps: Deps, change: Change, rules: Rules): Promise<boolean> {
  const subject = await deps.git.subjectOf("HEAD");
  const isReviewCommit = subject === `sdd(${change.slug}): review` || subject === `sdd(${change.slug}): files changed at the gate`;
  return isReviewCommit && (await shipErrors(deps, rules, change, true)).length === 0;
}

async function reviewRound(deps: Deps, change: Change, state: State, rules: Rules, ids: ReadonlyMap<string, string>, lines: readonly string[]): Promise<Step | Reviewed> {
  const diffPath = await writeReviewDiff(deps, change, state);
  const run = await stageRun(deps, change, state, rules, "review", [`Diff of the change: ${diffPath}`, ...lines]);
  const checked = await checkedStage(deps, change, state, [run], (_latest, findings) => shipErrors(deps, rules, change, findings !== undefined));
  if (checked.kind !== "passed") return endOf(deps, change, checked);
  const findings = checked.findings ?? [];
  const reviewed = await withReturnDone(change, checked.state);
  await writeOutcomeSections(deps, change, ids, findings);
  await deps.git.commitAll(`sdd(${change.slug}): review`);
  return { kind: "reviewed", state: reviewed, findings };
}

async function returnForFindings(deps: Deps, change: Change, state: State, findings: readonly Finding[]): Promise<Step> {
  const stage = RETURN_ORDER.find((candidate) => findings.some((finding) => finding.returnTo === candidate)) ?? "build";
  const reason = `Review findings: ${findings.map((finding) => `${finding.file}: ${finding.problem}`).join("; ")}`;
  const counted: State = { ...state, reviewRounds: state.reviewRounds + 1 };
  return { kind: "next", state: await returnChange(deps, change, counted, { stage, reason }) };
}

async function shipGate(deps: Deps, change: Change, state: State, rules: Rules, ids: ReadonlyMap<string, string>): Promise<Step> {
  let current = state;
  for (;;) {
    const reviewedHead = await deps.git.head();
    const answer = await deps.person.gate(`G3: ${GATE_QUESTIONS.G3}`, await gateSummary(deps, change, "G3", current, rules));
    if (answer.kind === "stop") return STOPPED;
    if (answer.kind === "approve") {
      const approved = await recordApproval(deps, change, "G3", current, reviewedHead);
      if (approved) return { kind: "next", state: approved };
      await redraft(deps, change, await policyOf(deps, change, current, rules), current, reviewedHead);
      continue;
    }
    const review = await reviewRound(deps, change, current, rules, ids, [`The person asked for this change at G3: ${answer.feedback}`]);
    if (review.kind !== "reviewed") return review;
    if (review.findings.length) return returnForFindings(deps, change, review.state, review.findings);
    current = review.state;
  }
}

/** The reviewer reads the diff from a file outside the project, so the review stage needs no bash. */
async function writeReviewDiff(deps: Deps, change: Change, state: State): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "sdd-review-")), `${change.slug}.diff`);
  await writeFile(path, await deps.git.diff(await deps.git.forkPoint(state.base)));
  return path;
}

async function writeOutcomeSections(deps: Deps, change: Change, ids: ReadonlyMap<string, string>, findings: readonly Finding[]): Promise<void> {
  const path = pathOf(change, "outcome.md");
  const text = (await readText(deps.root, path)) ?? `# Outcome: ${change.slug}\n`;
  const idMap = ids.size ? [...ids].map(([local, final]) => `- ${local} → ${final}`).join("\n") : "- none";
  const table = [
    "| # | File | Problem | Action | Return to |",
    "|---|---|---|---|---|",
    ...findings.map((finding, index) => `| ${index + 1} | ${finding.file} | ${finding.problem} | ${finding.action} | ${finding.returnTo} |`),
  ].join("\n");
  await writeFile(join(deps.root, path), upsertSection(upsertSection(text, "ID map", idMap), "Review", findings.length ? table : "No findings."));
}

async function mergedBase(deps: Deps, state: State): Promise<boolean> {
  const merge = await deps.git.mergeBase(state.base);
  if (merge.ok) return true;
  deps.person.notify(`Merging ${state.base} into this branch failed. Resolve the conflicts, commit, and run /sdd again.\n${merge.output}`, "error");
  return false;
}

async function reopenInvalidGates(deps: Deps, change: Change, state: State): Promise<State> {
  const [gate] = await invalidGates(deps, change, state, await readRules(deps.root));
  if (!gate) return state;
  return returnChange(deps, change, state, { stage: stageOf(gate), reason: `A file that ${gate} covers changed after the approval.` });
}
