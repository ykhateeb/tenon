import type { StageKind } from "../entities/write-policy.js";

const READ_TOOLS = ["read", "grep", "find", "ls"];

export const STAGE_TOOLS: Record<StageKind, readonly string[]> = {
  setup: [...READ_TOOLS, "write", "edit"],
  spec: [...READ_TOOLS, "write", "edit", "ask_owner", "classify_change"],
  plan: [...READ_TOOLS, "write", "edit", "request_return"],
  tests: [...READ_TOOLS, "bash", "write", "edit", "request_return"],
  build: [...READ_TOOLS, "bash", "write", "edit", "request_return"],
  review: [...READ_TOOLS, "write", "edit", "report_review"],
};

export const SDD_TOOLS: readonly string[] = ["ask_owner", "classify_change", "request_return", "report_review"];

export const GUIDES: Record<StageKind, string> = {
  setup: "setup.md",
  spec: "spec.md",
  plan: "plan.md",
  tests: "tests.md",
  build: "build.md",
  review: "review.md",
};
