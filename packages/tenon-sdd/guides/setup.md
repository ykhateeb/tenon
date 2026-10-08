# Setup: write sdd/rules.md

You write the rules of this project for spec-driven changes. The runner gave you this guide because `sdd/rules.md` is not in the repository yet. You can write only `sdd/rules.md`.

## Steps

1. Read the files that show how the project builds and tests: `package.json` (or the build file of the language), the test configuration, the CI files, and `AGENTS.md` or `CLAUDE.md` if they exist.
2. Find one command that runs all tests and writes JUnit XML reports. If the test tool does not write JUnit yet, add its reporter to the command. Examples:
   - Vitest: `npx vitest run --reporter=default --reporter=junit --outputFile.junit=reports/junit.xml`
   - Jest with jest-junit: `JEST_JUNIT_OUTPUT_DIR=reports npx jest --reporters=default --reporters=jest-junit`
   - Playwright: `PLAYWRIGHT_JUNIT_OUTPUT_NAME=reports/e2e.xml npx playwright test --reporter=junit`
   - pytest: `pytest --junitxml=reports/junit.xml`
   - Maestro: `maestro test --format junit --output reports/maestro.xml .maestro/`
   If the project needs several commands, join them with `&&` in the Full tier line.
3. Each JUnit report glob must start with a folder, for example `reports/*.xml`.
4. Write the globs of the test files in "Test files", for example `**/*.test.ts, e2e/**/*.e2e.ts`.
5. Write 3 to 6 principles. Take them from what the code already does. Each rule is one sentence that a person or a tool can check. "Write clean code" is not a rule. "All server data goes through one data layer" is a rule.
6. Write the file with the structure below. Keep the lines of the Commands section exactly in this form.
7. Stop. The runner runs the full tier and checks that the JUnit reports appear. If the check fails, you get a message: correct the file.

## Structure

```markdown
# Project Rules  (version 1.0)

## Principles
### 1. <Name>
Rule: <one sentence that a person or a tool can check>
Why: <reason>

## Quality defaults
- Performance: <target, or N/A>
- Security: <target>
- Privacy: <target>
- Accessibility: <target, or N/A if there is no UI>
- Reliability: <target>

## Commands
- Full tier: <one command that runs all tests and writes the JUnit reports>
- JUnit reports: <folder/glob>, <folder/glob>
- Fast tier: <a quick command for one story during Build>
- Test files: <glob>, <glob>
- Mutation: none
- Inner TDD: optional
- Merge method: <pull request on GitHub, or local merge>

## Flaky tests
- Run the test again once. If it is flaky, quarantine it with an owner, an issue, and a deadline.
- Never quarantine an acceptance test without approval from the G2 approver.

## Gate approvers
- G1 (spec): <name or role>
- G2 (plan and tests): <name or role>
- G3 (ship): <name or role>
```
