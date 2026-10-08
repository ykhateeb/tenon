import { join } from "node:path";
import type { Policy } from "../entities/write-policy.js";
import { parseRules } from "../entities/rules.js";
import type { State } from "../entities/state.js";
import { readText, RULES_PATH, type Change } from "./change.js";
import { runFullTier } from "./exit-checks.js";
import type { Deps, StageRun } from "./ports.js";
import { protectedErrors, redraft, runChecked } from "./run-stage.js";
import { GUIDES } from "./stages.js";

/** The subject of the one commit that holds the approved rules. Until it exists, the setup of the change is pending. */
export function rulesApprovedSubject(change: Change): string {
  return `sdd(${change.slug}): rules approved`;
}

/** The agent drafts sdd/rules.md, the runner validates it, and the person approves it. The rules merge with this change. */
export async function setupRules(deps: Deps, change: Change, state: State): Promise<"approved" | "stopped"> {
  const before = await beforeDrafts(deps, change);
  const policy: Policy = { kind: "setup", changeDir: change.dir, specLocked: false, lockedTests: [], testGlobs: [] };
  let feedback: string[] = [];
  for (;;) {
    const run: StageRun = { title: `sdd: setup (${change.slug})`, message: [`Read ${join(deps.guidesDir, GUIDES.setup)} and follow it.`, ...feedback].join("\n"), policy };
    const since = await deps.git.head();
    const end = await runChecked(deps, { runs: [run], protect: async () => protectedErrors(deps, change, policy, state, since), apply: async () => {}, check: () => parseRulesOnly(deps) });
    if (end.kind !== "passed") return "stopped";

    let reviewedHead = (await deps.git.commitAll(`sdd(${change.slug}): rules draft`)) ?? (await deps.git.head());

    for (;;) {
      const gateRulesText = await deps.git.fileAt(reviewedHead, RULES_PATH);
      const answer = await deps.person.gate(`Approve ${RULES_PATH}?`, `## Rules · ${change.slug}\n\n${gateRulesText ?? ""}`);
      if (answer.kind === "stop") return "stopped";
      if (answer.kind === "change") {
        feedback = [`The person asked for this change: ${answer.feedback}`];
        break; // Go back to agent session
      }

      // answer.kind === "approve"
      if (!(await deps.git.isClean()) || !(await isAtReviewed(deps, change, reviewedHead))) {
        await redraft(deps, change, policy, state, reviewedHead);
        reviewedHead = await deps.git.head();
        continue; // Show gate again
      }

      const rulesText = await deps.git.fileAt(reviewedHead, RULES_PATH);
      const rulesParsed = parseRules(rulesText ?? "");
      if (!rulesParsed.ok) {
        feedback = [`The full tier check failed: ${rulesParsed.errors.join(", ")}`];
        break; // Go back to agent session
      }

      const tier = await runFullTier(deps, rulesParsed.value);
      if (tier.errors.length) {
        feedback = tier.errors.map((error) => `The full tier check failed: ${error}`);
        break; // Go back to agent session
      }

      // The person can commit or switch the branch while the tier runs. The tier can write output files, so no clean check here.
      if (!(await isAtReviewed(deps, change, reviewedHead))) {
        await redraft(deps, change, policy, state, reviewedHead);
        reviewedHead = await deps.git.head();
        continue; // Show gate again
      }

      if (tier.code !== 0) deps.person.notify("The Full tier exits with an error. Build needs it to pass.", "warning");
      // The draft commits of this setup become one commit with the same content.
      await deps.git.resetSoft(before);
      await deps.git.commitAll(rulesApprovedSubject(change));
      return "approved";
    }
  }
}

async function isAtReviewed(deps: Deps, change: Change, reviewedHead: string): Promise<boolean> {
  return (await deps.git.head()) === reviewedHead && (await deps.git.currentBranch()) === `sdd/${change.folder}`;
}

// ponytail: the walk stops at a commit that is not a setup commit, such as a manual commit by the person. If the draft then has no change, the approval commit is empty, no commit is made, and the runner asks for the rules again at each resume.
/** HEAD, or the commit before the draft commits of an earlier setup that the person stopped. The approval commit replaces them. */
async function beforeDrafts(deps: Deps, change: Change): Promise<string> {
  const drafts = [`sdd(${change.slug}): rules draft`, `sdd(${change.slug}): files changed at the gate`];
  let ref = await deps.git.head();
  while (drafts.includes(await deps.git.subjectOf(ref))) ref = `${ref}~1`;
  return ref;
}

async function parseRulesOnly(deps: Deps): Promise<string[]> {
  const text = await readText(deps.root, RULES_PATH);
  if (text === undefined) return [`Write ${RULES_PATH}.`];
  const rules = parseRules(text);
  return rules.ok ? [] : rules.errors;
}
