import { describe, expect, it } from "vitest";
import { globBase, matchesAny } from "./glob.js";

describe("matchesAny", () => {
  it.each([
    ["src/a.test.ts", "**/*.test.ts", true],
    ["a.test.ts", "**/*.test.ts", true],
    ["src/a.ts", "**/*.test.ts", false],
    ["e2e/x/a.e2e.ts", "e2e/**/*.e2e.ts", true],
    ["e2e/a.e2e.ts", "e2e/**/*.e2e.ts", true],
    ["reports/junit.xml", "reports/*.xml", true],
    ["reports/sub/junit.xml", "reports/*.xml", false],
    ["reports/a+b.xml", "reports/a+b.xml", true],
    ["tests/a1.txt", "tests/a?.txt", true],
    ["tests/x/y.txt", "tests/**", true],
  ])("%s against %s is %s", (path, glob, expected) => {
    expect(matchesAny(path, [glob])).toBe(expected);
  });
});

describe("globBase", () => {
  it.each([
    ["reports/*.xml", "reports"],
    ["**/*.xml", ""],
    ["out/junit.xml", "out"],
    ["a/b/**/c.xml", "a/b"],
  ])("%s starts at %s", (glob, base) => {
    expect(globBase(glob)).toBe(base);
  });
});
