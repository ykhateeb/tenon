import { parsed, type ParseResult } from "./result.js";

export const STAGES = ["spec", "plan", "tests", "build", "ship", "done"] as const;
export type Stage = (typeof STAGES)[number];
export type WorkStage = Exclude<Stage, "done">;
export const GATES = ["G1", "G2", "G3"] as const;
export type Gate = (typeof GATES)[number];
export type Size = "full" | "small";
export const CHANGE_TYPES = ["feature", "change", "bug", "refactor", "chore", "docs"] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];
export type Classification = { type: ChangeType; size: Size };

export type Approval = { gate: Gate; result: "approved"; commit: string; by: string; at: string };
export type Reopening = { gate: Gate; result: "reopened"; reason: string; by: string; at: string };
export type GateEntry = Approval | Reopening;

export type State = {
  owner: string;
  base: string;
  request: string;
  size?: Size;
  type?: ChangeType;
  specVersion: number;
  stage: Stage;
  reviewRounds: number;
  gates: GateEntry[];
  /** True once the change reached Build. A return after that keeps the code, so a test can pass in Tests. */
  built?: boolean;
  /** The last return, until its stage passes the exit check. The stage sessions get the reason. */
  returned?: { stage: WorkStage; reason: string };
};
export type Return = { target: WorkStage; reason: string; by: string; at: string; size?: "full" };

const GATE_STAGE: Record<Gate, WorkStage> = { G1: "spec", G2: "tests", G3: "ship" };
const ENTRY_FIELDS: Record<GateEntry["result"], string[]> = { approved: ["commit", "by", "at"], reopened: ["reason", "by", "at"] };

export function parseState(json: string): ParseResult<State> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    return { ok: false, errors: [`state.json is not valid JSON: ${(error as Error).message}`] };
  }
  if (!isRecord(value)) return { ok: false, errors: ["state.json must hold an object."] };
  const errors: string[] = [];
  if (!STAGES.includes(value.stage as Stage)) errors.push(`state.json has an unknown stage "${String(value.stage)}".`);
  for (const key of ["owner", "base", "request"]) {
    if (typeof value[key] !== "string") errors.push(`state.json needs the text field "${key}".`);
  }
  // The base goes to git as an argument. No branch name starts with "-".
  if (typeof value.base === "string" && value.base.startsWith("-")) errors.push('state.json: "base" cannot start with "-".');
  if (typeof value.specVersion !== "number" || !Number.isInteger(value.specVersion) || value.specVersion < 1) {
    errors.push("state.json needs the integer field \"specVersion\" with a value of 1 or more.");
  }
  if (typeof value.reviewRounds !== "number" || !Number.isInteger(value.reviewRounds) || value.reviewRounds < 0) {
    errors.push("state.json needs the integer field \"reviewRounds\" with a value of 0 or more.");
  }
  if (!Array.isArray(value.gates)) errors.push('state.json needs the list "gates".');
  else errors.push(...value.gates.flatMap((entry: unknown, i) => gateEntryErrors(entry, `state.json: gates[${i}]`)));
  if (value.size !== undefined && value.size !== "full" && value.size !== "small") {
    errors.push(`state.json has an unknown size "${String(value.size)}".`);
  }
  if (value.type !== undefined && !CHANGE_TYPES.includes(value.type as ChangeType)) {
    errors.push(`state.json has an unknown type "${String(value.type)}".`);
  }
  if (value.built !== undefined && typeof value.built !== "boolean") errors.push('state.json: "built" must be true or false.');
  if (value.returned !== undefined && !isReturned(value.returned)) errors.push('state.json: "returned" needs a work stage and the text "reason".');
  return parsed(value as State, errors);
}

/** The gate at the end of a stage. The small size has only G3. */
export function gateAfter(stage: Stage, size: Size | undefined): Gate | undefined {
  return GATES.find((gate) => GATE_STAGE[gate] === stage && (gate === "G3" || size !== "small"));
}

export function stageOf(gate: Gate): WorkStage {
  return GATE_STAGE[gate];
}

export function nextStage(state: State): Stage {
  const currentIndex = STAGES.indexOf(state.stage);
  for (let i = currentIndex + 1; i < STAGES.length; i++) {
    const stage = STAGES[i];
    if (!(stage === "plan" && state.size === "small") && !(stage === "tests" && state.type === "docs")) {
      return stage;
    }
  }
  return "done";
}

/** The approval of a gate, if the last entry of that gate is an approval. */
export function approvalOf(state: State, gate: Gate): Approval | undefined {
  const last = state.gates.filter((entry) => entry.gate === gate).at(-1);
  return last?.result === "approved" ? last : undefined;
}

export function withApproval(state: State, approval: Omit<Approval, "result">): State {
  return {
    ...state,
    stage: approval.gate === "G3" ? "done" : state.stage,
    gates: [...state.gates, { ...approval, result: "approved" }],
  };
}

/**
 * The return rule: go back to the target stage, and reopen each approved gate at or after it.
 * A small change that becomes full starts again at Spec, because a full change needs G1.
 */
export function returnedTo(state: State, { target, reason, by, at, size }: Return): State {
  const becomesFull = state.size === "small" && (size === "full" || target === "plan");
  const stage: WorkStage = becomesFull ? "spec" : target;
  const isReopened = (gate: Gate) => STAGES.indexOf(GATE_STAGE[gate]) >= STAGES.indexOf(stage) && approvalOf(state, gate) !== undefined;
  const reopened = GATES.filter(isReopened).map((gate): Reopening => ({ gate, result: "reopened", reason, by, at }));
  const isSpecChange = stage === "spec" && approvalOf(state, "G1") !== undefined;
  return {
    ...state,
    stage,
    size: becomesFull ? "full" : (size ?? state.size),
    specVersion: isSpecChange ? state.specVersion + 1 : state.specVersion,
    gates: [...state.gates, ...reopened],
    returned: { stage, reason },
  };
}

/** A return goes to the current stage or an earlier one. A later stage would skip a gate, so the current stage starts again. */
export function returnTarget(state: State, target: WorkStage): WorkStage {
  return state.stage !== "done" && STAGES.indexOf(target) > STAGES.indexOf(state.stage) ? state.stage : target;
}

export function classificationError(state: State, { type, size }: Classification): string | undefined {
  if (type === "feature" && size === "small") return "A feature is always full size.";
  // A reopened G1 still saw the full spec, so any G1 entry counts.
  if (size === "small" && state.size === "full" && state.gates.some((entry) => entry.gate === "G1")) return "A full change cannot become small after G1.";
  return undefined;
}

function gateEntryErrors(entry: unknown, at: string): string[] {
  if (!isRecord(entry)) return [`${at} must be an object.`];
  const errors = GATES.includes(entry.gate as Gate) ? [] : [`${at} has an unknown gate "${String(entry.gate)}".`];
  if (entry.result !== "approved" && entry.result !== "reopened") return [...errors, `${at} has an unknown result "${String(entry.result)}".`];
  const missing = ENTRY_FIELDS[entry.result].filter((key) => typeof entry[key] !== "string");
  return [...errors, ...missing.map((key) => `${at} needs the text field "${key}".`)];
}

function isReturned(value: unknown): boolean {
  return isRecord(value) && STAGES.includes(value.stage as Stage) && value.stage !== "done" && typeof value.reason === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
