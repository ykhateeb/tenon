import { join } from "node:path";
import type { Policy } from "../entities/write-policy.js";
import { parseRules } from "../entities/rules.js";
import { readState, readText, RULES_PATH, type Change } from "./change.js";
import { runFullTier } from "./exit-checks.js";
import type { Deps, StageRun } from "./ports.js";
import { protectedErrors, runChecked } from "./run-stage.js";
import { GUIDES } from "./stages.js";

/** The agent drafts sdd/rules.md, the runner validates it, and the person approves it. The rules merge with this change. */
export async function setupRules(deps: Deps, change: Change): Promise<"approved" | "stopped"> {
  const state = await readState(change);
  const policy: Policy = { kind: "setup", changeDir: change.dir, specLocked: false, lockedTests: [], testGlobs: [] };
  let feedback: string[] = [];
  for (;;) {
    const run: StageRun = { title: `sdd: setup (${change.slug})`, message: [`Read ${join(deps.guidesDir, GUIDES.setup)} and follow it.`, ...feedback].join("\n"), policy };
    const since = await deps.git.head();
    const end = await runChecked(deps, { runs: [run], protect: async () => protectedErrors(deps, change, policy, state, since), apply: async () => {}, check: () => parseRulesOnly(deps) });
    if (end.kind !== "passed") return "stopped";

    const reviewedHead = (await deps.git.commitAll(`sdd(${change.slug}): rules draft`)) ?? (await deps.git.head());

    const answer = await deps.person.gate(`Approve ${RULES_PATH}?`, `## Rules · ${change.slug}\n\n${(await readText(deps.root, RULES_PATH)) ?? ""}`);
    if (answer.kind === "stop") return "stopped";
    if (answer.kind === "change") {
      feedback = [`The person asked for this change: ${answer.feedback}`];
      continue;
    }

    // answer.kind === "approve"
    const head = await deps.git.head();
    if (!(await deps.git.isClean()) || head !== reviewedHead) {
      deps.person.notify("Files changed after the summary. Review the gate again.", "warning");
      continue;
    }

    const rulesText = await readText(deps.root, RULES_PATH);
    const rulesParsed = parseRules(rulesText ?? "");
    if (!rulesParsed.ok) {
      feedback = [`The full tier check failed: ${rulesParsed.errors.join(", ")}`];
      continue;
    }

    const tier = await runFullTier(deps, rulesParsed.value);
    if (tier.errors.length) {
      feedback = tier.errors.map((error) => `The full tier check failed: ${error}`);
      continue;
    }

    return "approved";
  }
}

async function parseRulesOnly(deps: Deps): Promise<string[]> {
  const text = await readText(deps.root, RULES_PATH);
  if (text === undefined) return [`Write ${RULES_PATH}.`];
  const rules = parseRules(text);
  return rules.ok ? [] : rules.errors;
}
