import { describe, expect, it } from "vitest";
import { parseRules } from "./rules.js";

const RULES = `# Project Rules  (version 1.0)

## Principles
### 1. Tests first
Rule: Each scenario has a test.

## Commands
- Full tier: npm test
- JUnit reports: reports/*.xml, e2e-reports/*.xml
- Fast tier: npx vitest run --changed
- Test files: **/*.test.ts, e2e/**/*.e2e.ts
- Mutation: none
- Inner TDD: required
- Merge method: pull request on GitHub
`;

describe("parseRules", () => {
  it("reads each command line", () => {
    expect(parseRules(RULES)).toEqual({
      ok: true,
      value: {
        fullTier: "npm test",
        junitReports: ["reports/*.xml", "e2e-reports/*.xml"],
        fastTier: "npx vitest run --changed",
        testFiles: ["**/*.test.ts", "e2e/**/*.e2e.ts"],
        mutation: undefined,
        innerTdd: "required",
      },
    });
  });

  it("names each missing required line", () => {
    const result = parseRules("## Commands\n- Fast tier: x\n");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join("\n")).toMatch(/Full tier[\s\S]*JUnit reports[\s\S]*Test files/);
  });

  it("defaults Inner TDD to optional and keeps a mutation command", () => {
    const result = parseRules(RULES.replace("- Inner TDD: required\n", "").replace("Mutation: none", "Mutation: npx stryker run"));
    expect(result.ok && result.value).toMatchObject({ innerTdd: "optional", mutation: "npx stryker run" });
  });

  it("rejects an unknown Inner TDD value and a report glob with no folder", () => {
    const result = parseRules(RULES.replace("Inner TDD: required", "Inner TDD: sometimes").replace("reports/*.xml, e2e-reports/*.xml", "**/*.xml"));
    expect(result.ok ? "" : result.errors.join("\n")).toMatch(/Inner TDD[\s\S]*folder/);
  });

  it("ignores lines outside the Commands section", () => {
    const result = parseRules(`## Notes\n- Full tier: wrong\n\n${RULES}`);
    expect(result.ok && result.value.fullTier).toBe("npm test");
  });

  it("accepts CRLF line ends", () => {
    expect(parseRules(RULES.replaceAll("\n", "\r\n")).ok).toBe(true);
  });
});
