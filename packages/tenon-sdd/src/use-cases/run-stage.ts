import type { State } from "../entities/state.js";
import type { Policy } from "../entities/write-policy.js";
import { AREAS_DIR, pathOf, readText, RULES_PATH, stateText, writeState, type Change } from "./change.js";
import type { Deps, ReturnRequest, StageOutcome, StageRun } from "./ports.js";

export type StageEnd = { kind: "passed" } | { kind: "stopped" } | { kind: "returned"; request: ReturnRequest };
export type CheckedRun = {
  runs: readonly StageRun[];
  protect: () => Promise<string[]>;
  apply: (outcome: StageOutcome) => Promise<void>;
  check: () => Promise<string[]>;
};

const CHECKS_BEFORE_ASKING = 3;
const TRY_AGAIN = "Try again";

/**
 * Run the sessions of a stage, then the protected-path check and the exit check.
 * A failed check goes to the last session as a follow-up message. After each 3 failed checks, the person decides.
 */
export async function runChecked(deps: Deps, { runs, protect, apply, check }: CheckedRun): Promise<StageEnd> {
  for (const run of runs) {
    const end = await settle(await deps.agent.run(run), apply, protect);
    if (end) return end;
  }
  for (let failures = 0; ; ) {
    const errors = [...(await protect()), ...(await check())];
    if (!errors.length) return { kind: "passed" };
    failures++;
    if (failures % CHECKS_BEFORE_ASKING === 0 && !(await shouldTryAgain(deps, runs[0]?.title ?? "sdd", failures))) return { kind: "stopped" };
    const end = await settle(await deps.agent.followUp(failureMessage(errors)), apply, protect);
    if (end) return end;
  }
}

/**
 * The bash gap: the tool_call guard cannot see files that bash writes.
 * Restore each protected file that changed since `since`, and state.json if it is not the state of the runner.
 */
export async function protectedErrors(deps: Deps, change: Change, policy: Policy, state: State, since: string): Promise<string[]> {
  const branch = await deps.git.currentBranch();
  if (branch !== `sdd/${change.folder}`) {
    throw new Error(`The branch changed to "${branch}". Switch back to sdd/${change.folder} and run /sdd again.`);
  }

  const own = [AREAS_DIR, ...(policy.kind === "setup" ? [] : [RULES_PATH]), ...(policy.specLocked ? [pathOf(change, "spec.md")] : []), ...policy.lockedTests];
  const otherChanges = ["sdd/changes", `:(exclude)${change.dir}`];
  const errors: string[] = [];

  const head = await deps.git.head();
  if (head !== since) {
    await deps.git.resetSoft(since);
    errors.push("Do not run git commit. The runner commits. Your commits were undone; their changes stay in the working tree.");
  }

  const changed = [...(await deps.git.changedSince(since, own)), ...(await deps.git.changedSince(since, otherChanges))];
  if (changed.length) {
    await deps.git.restore(since, changed);
    errors.push(`You changed ${changed.join(", ")}, which this stage cannot change. The runner restored the files. Use request_return if a change there is necessary.`);
  }
  if ((await readText(deps.root, pathOf(change, "state.json"))) !== stateText(state)) {
    await writeState(change, state);
    errors.push("You changed state.json. The runner restored it. Only the runner changes state.json.");
  }
  return errors;
}

/** Files changed while the person read a gate: restore the protected files, tell the person, and commit a new draft. */
export async function redraft(deps: Deps, change: Change, policy: Policy, state: State, reviewedHead: string): Promise<void> {
  const errors = await protectedErrors(deps, change, policy, state, reviewedHead);
  deps.person.notify("Files changed after the summary. Review the gate again.", "warning");
  for (const error of errors) deps.person.notify(error, "warning");
  await deps.git.commitAll(`sdd(${change.slug}): files changed at the gate`);
}

async function settle(outcome: StageOutcome, apply: CheckedRun["apply"], protect: CheckedRun["protect"]): Promise<StageEnd | undefined> {
  if (outcome.aborted) {
    await protect();
    return { kind: "stopped" };
  }
  if (outcome.returnRequest) {
    await protect();
    return { kind: "returned", request: outcome.returnRequest };
  }
  await apply(outcome);
  return undefined;
}

async function shouldTryAgain(deps: Deps, title: string, failures: number): Promise<boolean> {
  return (await deps.person.choose(`${title}: the exit check failed ${failures} times.`, [TRY_AGAIN, "Stop"])) === TRY_AGAIN;
}

function failureMessage(errors: readonly string[]): string {
  return ["The exit check of this stage failed. Correct these items, then stop:", ...errors.map((error) => `- ${error}`)].join("\n");
}
