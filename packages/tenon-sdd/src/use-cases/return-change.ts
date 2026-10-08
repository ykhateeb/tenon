import { returnedTo, type State, type WorkStage } from "../entities/state.js";
import { AREAS_DIR, isoDate, writeState, type Change } from "./change.js";
import type { Deps } from "./ports.js";

export type ReturnOrder = { stage: WorkStage; reason: string; size?: "full" };

/** The return rule: set the stage, reopen the gates, undo the area spec edits of an earlier Ship, and commit. */
export async function returnChange(deps: Deps, change: Change, state: State, { stage, reason, size }: ReturnOrder): Promise<State> {
  const returned = returnedTo(state, { target: stage, reason, by: "runner", at: isoDate(deps.now()) });
  const next: State = size ? { ...returned, size } : returned;
  await restoreAreas(deps, state.base);
  await writeState(change, next);
  await deps.git.commitAll(`sdd(${change.slug}): return to ${stage}`);
  return next;
}

/** The area specs come again from the base branch. */
async function restoreAreas(deps: Deps, base: string): Promise<void> {
  const edited = (await deps.git.changedBetween(await deps.git.forkPoint(base), "HEAD")).filter((path) => path.startsWith(`${AREAS_DIR}/`));
  if (edited.length) await deps.git.restore(base, edited);
}
