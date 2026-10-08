import { join } from "node:path";
import type { Policy } from "../entities/write-policy.js";
import { readState, readText, RULES_PATH, type Change } from "./change.js";
import { setupErrors } from "./exit-checks.js";
import type { Deps, StageRun } from "./ports.js";
import { protectedErrors, runChecked } from "./run-stage.js";
import { GUIDES } from "./stages.js";

/** The agent drafts sdd/rules.md, the runner tries its commands, and the person approves it. The rules merge with this change. */
export async function setupRules(deps: Deps, change: Change): Promise<"approved" | "stopped"> {
  const state = await readState(change);
  const policy: Policy = { kind: "setup", changeDir: change.dir, specLocked: false, lockedTests: [], testGlobs: [] };
  let feedback: string[] = [];
  for (;;) {
    const run: StageRun = { title: `sdd: setup (${change.slug})`, message: [`Read ${join(deps.guidesDir, GUIDES.setup)} and follow it.`, ...feedback].join("\n"), policy };
    const end = await runChecked(deps, { runs: [run], protect: () => protectedErrors(deps, change, policy, state), apply: async () => {}, check: () => setupErrors(deps) });
    if (end.kind !== "passed") return "stopped";
    const answer = await deps.person.gate(`Approve ${RULES_PATH}?`, `## Rules · ${change.slug}\n\n${(await readText(deps.root, RULES_PATH)) ?? ""}`);
    if (answer.kind === "stop") return "stopped";
    if (answer.kind === "approve") {
      await deps.git.commitAll(`sdd(${change.slug}): rules approved`);
      return "approved";
    }
    feedback = [`The person asked for this change: ${answer.feedback}`];
  }
}
