import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { classificationError, parseState } from "../entities/state.js";
import { ENTRY } from "../use-cases/ports.js";
import type { StageContext } from "./pi-guard.js";

const OTHER = "Other";
const NO_ANSWER = "No answer. Ask again later, or stop the stage and write why in your last message.";
const STAGE_UNION = Type.Union([Type.Literal("spec"), Type.Literal("plan"), Type.Literal("tests"), Type.Literal("build")]);

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: undefined });

/** The model tools of the stage sessions. They report to the runner through custom session entries. */
export function sddTools(pi: ExtensionAPI, stage: StageContext) {
  return [askOwner(), classifyChange(pi, stage), requestReturn(pi), reportReview(pi)];
}

function askOwner() {
  return defineTool({
    name: "ask_owner",
    label: "Ask the owner",
    description: "Ask the owner of the change one question. Say why it matters and give your recommended answer. Give options when the answer is a choice.",
    exposure: "model-only",
    parameters: Type.Object({
      question: Type.String(),
      why: Type.String(),
      options: Type.Optional(Type.Array(Type.String())),
      recommended: Type.String(),
    }),
    async execute(_id, { question, why, options, recommended }, _signal, _onUpdate, ctx) {
      const title = `${question}\n\n${why}`;
      const answer = options?.length ? await chosenAnswer(ctx, title, options, recommended) : await typedAnswer(ctx, title, recommended);
      return text(answer === undefined ? NO_ANSWER : `The owner answered: ${answer}`);
    },
  });
}

function classifyChange(pi: ExtensionAPI, stage: StageContext) {
  return defineTool({
    name: "classify_change",
    label: "Classify the change",
    description: "Set the type and the size of the change. A feature is always full size. A small change has an empty delta or one MODIFIED item.",
    exposure: "model-only",
    parameters: Type.Object({
      type: Type.Union([Type.Literal("feature"), Type.Literal("change"), Type.Literal("bug"), Type.Literal("refactor"), Type.Literal("chore"), Type.Literal("docs")]),
      size: Type.Union([Type.Literal("full"), Type.Literal("small")]),
      reason: Type.String(),
    }),
    async execute(_id, { type, size }, _signal, _onUpdate, ctx) {
      if (!stage.policy) throw new Error("classify_change works only in an sdd stage session.");
      const state = parseState(await readFile(join(ctx.cwd, stage.policy.changeDir, "state.json"), "utf8"));
      if (!state.ok) throw new Error(state.errors.join(" "));
      const error = classificationError(state.value, { type, size });
      if (error) throw new Error(error);
      pi.appendEntry(ENTRY.classify, { type, size });
      return text(`Recorded: ${type}, ${size} size.`);
    },
  });
}

function requestReturn(pi: ExtensionAPI) {
  return defineTool({
    name: "request_return",
    label: "Return to an earlier stage",
    description:
      "Report a problem that an earlier stage owns: wrong or missing behavior (spec), a wrong approach or a missing task (plan), a wrong or weak approved test (tests), a code defect (build). Use size full to make a small change full. With size full, the change starts again at the spec stage. After this call, stop.",
    exposure: "model-only",
    parameters: Type.Object({
      stage: STAGE_UNION,
      reason: Type.String(),
      size: Type.Optional(Type.Literal("full")),
    }),
    async execute(_id, { stage, reason, size }) {
      pi.appendEntry(ENTRY.returnRequest, { stage, reason, size });
      return { ...text(`The runner returns the change to the ${stage} stage after this session. Stop now.`), terminate: true };
    },
  });
}

function reportReview(pi: ExtensionAPI) {
  return defineTool({
    name: "report_review",
    label: "Report the review",
    description: "Report all review findings in one call. Give an empty list if there are none. Each finding names the stage that owns the fix.",
    exposure: "model-only",
    parameters: Type.Object({
      findings: Type.Array(
        Type.Object({
          file: Type.String(),
          problem: Type.String(),
          action: Type.String(),
          returnTo: STAGE_UNION,
        }),
      ),
    }),
    async execute(_id, { findings }) {
      pi.appendEntry(ENTRY.review, { findings });
      return text(findings.length ? `Recorded ${findings.length} findings.` : "Recorded: no findings.");
    },
  });
}

async function chosenAnswer(ctx: ExtensionContext, title: string, options: readonly string[], recommended: string): Promise<string | undefined> {
  const marked = `${recommended} (recommended)`;
  const choice = await ctx.ui.select(title, [marked, ...options.filter((option) => option !== recommended), OTHER]);
  if (choice === OTHER) return typedAnswer(ctx, title, "");
  return choice === marked ? recommended : choice;
}

/** Tenon shows the second input argument as a hint. An empty answer means "use the recommended answer". */
async function typedAnswer(ctx: ExtensionContext, title: string, recommended: string): Promise<string | undefined> {
  const answer = await ctx.ui.input(title, recommended);
  if (answer === undefined) return undefined;
  return answer.trim() || recommended || undefined;
}
