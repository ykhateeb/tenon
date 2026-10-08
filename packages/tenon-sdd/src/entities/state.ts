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
  if (typeof value.specVersion !== "number" || !Number.isInteger(value.specVersion) || value.specVersion < 1) {
    errors.push("state.json needs the integer field \"specVersion\" with a value of 1 or more.");
  }
  if (typeof value.reviewRounds !== "number" || !Number.isInteger(value.reviewRounds) || value.reviewRounds < 0) {
    errors.push("state.json needs the integer field \"reviewRounds\" with a value of 0 or more.");
  }
  if (!Array.isArray(value.gates)) errors.push('state.json needs the list "gates".');
  else {
    for (let i = 0; i < value.gates.length; i++) {
      const entry = value.gates[i];
      if (!isRecord(entry)) {
        errors.push(`state.json: gates[${i}] must be an object.`);
        continue;
      }
      if (!GATES.includes(entry.gate as Gate)) {
        errors.push(`state.json: gates[${i}] has an unknown gate "${String(entry.gate)}".`);
      }
      if (entry.result !== "approved" && entry.result !== "reopened") {
        errors.push(`state.json: gates[${i}] has an unknown result "${String(entry.result)}".`);
      }
    }
  }
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
  if (stage === "ship") return "G3";
  if (size === "small") return undefined;
  if (stage === "spec") return "G1";
  if (stage === "tests") return "G2";
  return undefined;
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
  const reopened: Reopening[] = GATES.filter((gate) => STAGES.indexOf(GATE_STAGE[gate]) >= STAGES.indexOf(stage) && approvalOf(state, gate)).map(
    (gate) => ({ gate, result: "reopened", reason, by, at }),
  );
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

export function classificationError(state: State, { type, size }: Classification): string | undefined {
  if (type === "feature" && size === "small") return "A feature is always full size.";
  if (size === "small" && state.size === "full" && approvalOf(state, "G1")) return "A full change cannot become small after G1.";
  return undefined;
}

function isReturned(value: unknown): boolean {
  return isRecord(value) && STAGES.includes(value.stage as Stage) && value.stage !== "done" && typeof value.reason === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
