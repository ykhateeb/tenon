import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createGit, type Git } from "../adapters/git.js";

export const RULES = `# Project Rules  (version 1.0)

## Commands
- Full tier: node fake-tests.mjs
- JUnit reports: reports/*.xml
- Fast tier: node fake-tests.mjs
- Test files: tests/**
- Mutation: none
- Inner TDD: optional
`;

export const AREA = `# Area spec: Favorites
Prefix: FAV   Next IDs: FAV-R-005, FAV-Q-002

## Current behavior
- FAV-R-001: Users can add and remove a favorite.  (since 2026-09-14-favorites)
- FAV-R-002: List shows in the order added  (since 2026-09-14-favorites)
- FAV-R-003: Max 100 favorites  (since 2026-09-14-favorites)
- FAV-R-004: Favorites sync across devices.  (since 2026-09-14-favorites)

## Quality requirements
- FAV-Q-001: List opens in < 500 ms with 100 items.  (since 2026-09-14-favorites)

## Tests
- FAV-R-001 → favorites-us1-s1

## History
- 2026-09-14-favorites: created the area
`;

/** A test runner for tests: each line of tests/**.txt is "<test name>|<file that must exist>". It writes reports/junit.xml. */
const FAKE_TESTS = `import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
const files = readdirSync("tests", { recursive: true }).map(String).filter((file) => file.endsWith(".txt"));
const cases = files.flatMap((file) => readFileSync("tests/" + file, "utf8").split("\\n").filter(Boolean).map((line) => {
  const [name, needs] = line.split("|");
  return { name, failed: !existsSync(needs) };
}));
mkdirSync("reports", { recursive: true });
const body = cases.map((c) => '<testcase classname="fake" name="' + c.name + '">' + (c.failed ? "<failure>missing</failure>" : "") + "</testcase>").join("");
writeFileSync("reports/junit.xml", '<testsuites><testsuite name="fake">' + body + "</testsuite></testsuites>");
process.exit(cases.some((c) => c.failed) ? 1 : 0);
`;

export type FakeProject = {
  root: string;
  git: Git;
  write(path: string, text: string): void;
  read(path: string): string;
  run(...args: string[]): string;
};

/** A git repository on the branch main with an area spec, a fake test runner, and (by default) sdd/rules.md. */
export function createFakeProject({ withRules = true }: { withRules?: boolean } = {}): FakeProject {
  const root = mkdtempSync(join(tmpdir(), "tenon-sdd-"));
  const run = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  run("init", "-q", "-b", "main");
  run("config", "user.name", "Sam");
  run("config", "user.email", "sam@example.com");
  run("config", "commit.gpgsign", "false");
  write(".gitignore", "reports/\n");
  write("fake-tests.mjs", FAKE_TESTS);
  write("src/app.txt", "app\n");
  write("tests/base.txt", "favorites-us1-s1|src/app.txt\n");
  write("sdd/areas/favorites.md", AREA);
  if (withRules) write("sdd/rules.md", RULES);
  run("add", "-A");
  run("commit", "-q", "-m", "base");
  return { root, git: createGit(root), write, read: (path) => readFileSync(join(root, path), "utf8"), run };
}
