# Spec-Driven Development package for Tenon (`tenon-sdd`)

Date: 2026-10-08. Status: waiting for review.

## 1. Goal

A Tenon user changes their own project with the workflow in `spec-driven-development-simple-workflow.md` (the workflow document). The package runs that workflow. Code, not the model, controls the stage order and the checks. A person approves each gate.

Success criteria:

1. A user goes from a request to a branch that is ready to merge. Each gate is a dialog.
2. Code enforces the hard rules: only a person approves a gate, the approved tests are locked, only Ship edits the area specs, and the folders of other changes do not change.
3. A change continues from its files and commits after an app restart.
4. Each stage runs in its own session. Build uses one session for each story. The context stays small.

The package also works in terminal pi.

## 2. Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Form | A pi package, `packages/tenon-sdd/`: one extension and one guide file for each stage. The guides are not pi skills, so they load only when the runner asks for them. |
| 2 | Control | A runner. `/sdd <request>` starts a change. Code runs each stage in a new session. It stops only at gates, questions to the owner, and failures. |
| 3 | Test proof | JUnit XML. Code reads the reports and checks each scenario. |
| 4 | Merge | The person merges. The runner commits only on the change branch. It never pushes and never merges. |
| 5 | `rules.md` | The agent writes a draft from the code. Code runs each command. The person approves the file. |
| 6 | Code and agent | Code owns the source of truth: IDs, the delta, the area specs, `state.json`, the traceability status, gates, and commits. The agent writes prose, code, and tests. |
| 7 | Git | One branch for each change, made from the current branch (the base). |
| 8 | Parallel changes | One change at a time in each project. Worktrees come later (section 11). |
| 9 | Sessions | One new session for each stage. Build uses one session for the foundation, one for each story, and one check session. |
| 10 | UI | The dialogs that Tenon already shows: `select` and `input`. One renderer change: the gate message shows as Markdown. |
| 11 | Inner TDD | A `rules.md` line, `Inner TDD: optional \| required`. The Build guide follows it. Code does not check it. |
| 12 | Scope | Both sizes, the brownfield baseline, an AI reviewer at Ship, and mutation testing through an exit code. |
| 13 | Approver | The person at the keyboard. v1 does not check identity. |

## 3. Architecture

### 3.1 Files

```
packages/tenon-sdd/
  package.json            keyword pi-package; "pi": { "extensions": ["./src/extension.ts"] };
                          @earendil-works/pi-coding-agent and typebox as peer dependencies
  CLAUDE.md               package rules, the same form as tenon-canvas
  guides/                 setup.md  spec.md  plan.md  tests.md  build.md  review.md
  src/
    extension.ts          composition root: makes the adapters, wires them into the use cases, registers /sdd

    entities/             pure rules on strings and plain data: no pi, no fs, no git
      state.ts            state.json type, gate status, the return rule
      delta.ts            parse the stories, scenarios, baseline, and delta of spec.md
      area-spec.ts        parse an area spec, stale check, give IDs, apply the delta
      traceability.ts     parse traceability.md, check it against test cases
      plan.ts             parse the task lines of plan.md, the consistency check
      rules.ts            parse the Commands section of rules.md
      write-policy.ts     which paths each stage can write

    use-cases/            the actions of the workflow
      ports.ts            Agent and Person
      stages.ts           one row for each stage: guide, active tools, writable paths, exit check
      setup-rules.ts      the agent drafts rules.md, code runs the commands, the person approves
      start-change.ts     branch, change folder, first state.json
      run-change.ts       the stage loop: next stage → stage session → exit check → gate → next or return
      exit-checks.ts      the exit check of each stage
      approve-gate.ts     gate message → Person → commit → approval entry → commit of state.json
      return-change.ts    the return rule
      ship-apply.ts       Ship steps 2–5: stale check, final IDs, delta applied to the area specs

    adapters/             the outside world
      junit.ts            JUnit XML → test cases
      git.ts              branch, commit, merge the base, "changed since commit", conflict check
      shell.ts            run a command with a timeout
      pi-agent.ts         implements Agent: newSession, setActiveTools, sendUserMessage, waitForIdle
      pi-person.ts        implements Person: ctx.ui select and input, and the gate message
      pi-tools.ts         model tools: ask_owner, classify_change, request_return, report_review
      pi-guard.ts         tool_call handler: calls write-policy.ts and blocks the call
```

Each test file sits next to the file that it tests. File names use kebab-case, the same as Tenon.

### 3.2 Import rules

| Folder | Can import |
|---|---|
| `entities/` | Nothing outside `entities/` |
| `use-cases/` | `entities/`, `use-cases/`, and `adapters/git.ts`, `adapters/shell.ts`, `adapters/junit.ts` |
| `adapters/` | `entities/`, `use-cases/ports.ts`, `use-cases/stages.ts`, pi, node |
| `extension.ts` | Everything |

The use cases import `git.ts`, `shell.ts`, and `junit.ts` directly, with no port. The tests use a real git repository and real commands in a temporary folder, so they need no fake. Only `Agent` and `Person` have ports, because the tests must fake the model and the person.

All imports in the package are relative, so terminal pi can load it with jiti. State lives in `create…()` factories (for example `createRunner`), not at module level, as the Tenon `CLAUDE.md` requires. Tests that need files use `mkdtempSync(join(tmpdir(), "tenon-sdd-"))`.

### 3.3 Ports

```ts
type StageRun = { stage: Stage; message: string; tools: string[]; title: string };
type StageResult = { aborted: boolean };

interface Agent {
  run(stage: StageRun): Promise<StageResult>;
}

type GateAnswer = { kind: "approve" } | { kind: "change"; feedback: string } | { kind: "stop" };

interface Person {
  gate(gate: Gate, summary: string): Promise<GateAnswer>;
  ask(question: Question): Promise<string | undefined>;
  choose(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, prefill: string): Promise<string | undefined>;
  notify(message: string): void;
}
```

### 3.4 Changes in Tenon

1. `src/core/sessions/runtime.ts`: add `{ name: "tenon-sdd", factory: (pi) => tenonSdd(pi, { guidesDir }) }` to `extensionFactories`, next to the canvas. `guidesDir` is `join(import.meta.dirname, "../../packages/tenon-sdd/guides")`, the same form as the canvas skills path.
2. `electron-builder.yml`: include `packages/tenon-sdd/guides/**`.
3. `src/renderer/src/chat/Chat.tsx`: show a custom message with `customType: "sdd-gate"` as Markdown, with the `Markdown` component that the chat already uses. Other custom messages do not change.

In terminal pi, `extension.ts` finds `guidesDir` from its own location (`../guides`).

## 4. The run

### 4.1 Start: `/sdd <request>`

1. The runner refuses to start, with a toast, if:
   - the project is not trusted;
   - `ctx.hasUI` is false;
   - the folder has no git repository;
   - the working tree is not clean;
   - the current branch starts with `sdd/`.
2. The runner suggests a slug from the request: lower case, hyphens, at most 5 words. The person can edit it in an `input` dialog. If a folder in `sdd/changes/` (any date) or a local or remote branch already uses the slug, the runner adds `-2`. A unique slug keeps the test names unique, because they start with the slug.
3. `start-change` makes the branch `sdd/<YYYY-MM-DD>-<slug>` from the current branch, and records the current branch as `base`.
4. `start-change` writes `sdd/changes/<YYYY-MM-DD>-<slug>/state.json` with `stage: "spec"` and commits it. The owner is `git config user.name` (decision 13).
5. If `sdd/rules.md` is not in the last commit, `setup-rules` runs before the stage. The person approves the file, and the runner commits it. Thus the file merges with the first change, and a resume runs Setup again only if the approval did not happen.

### 4.2 Each stage

1. Before each stage, code merges the base branch into the change branch, to find conflicts early. The tree is clean at this time, because the runner commits after each passed exit check (section 7.4).
2. Before the first `newSession`, the runner keeps only plain data: the cwd, the start session file, and the change folder. After each `newSession`, it continues with the context that `withSession` gives.
3. `pi-agent` opens a new session with `parentSession` set to the start session file, so all stage sessions show under the start chat. The session name is `sdd: <stage> (<slug>)`.
4. `pi-agent` sets the tools of the stage (section 7.1). It sends one message: the path of the guide, the change folder, and the stage input. For a Build story, the message names the story. For a gate answer **Change**, the message has the feedback of the person.
5. When the session is idle, code runs the protected-path check (section 7.3) and the exit check of the stage (section 6). If both pass, the runner commits.
6. If a check fails, the runner sends the failure text to the same session as a follow-up message. After 3 failed checks, the person selects **Try again** or **Stop**. **Try again** gives 3 more checks.
7. Build runs these sessions in order: one for the foundation tasks, one for each story in priority order, and one check session for steps 5–9 of the workflow document. The small size uses one Build session.
8. For the type `docs`, the runner skips Stage 3. A docs change has no tests.

### 4.3 Gates

1. `approve-gate` sends a custom message with `customType: "sdd-gate"` and `display: true`. It contains the gate question and the full text of the files that the gate covers. For test code, it contains only the paths.
2. `Person.gate` shows `select("<gate>: <question>", ["Approve", "Change", "Stop"])`:
   - **Approve:** the runner commits all work with the message `sdd(<slug>): <gate> approved`. It adds the approval entry with that commit, and then commits `state.json`.
   - **Change:** an `input` dialog asks what must change. A new session of the stage starts with the feedback. Then the exit check and the gate run again.
   - **Stop**, or no answer: the run stops. The next `/sdd` shows the same gate.
3. After G3, the runner sets `stage: "done"` in the same edit as the approval. It tells the person that the branch is ready to merge.

### 4.4 Questions and returns

- `ask_owner` (input: `question`, `why`, `options?`, `recommended`) shows a `select` with the recommended option first, marked "(recommended)", and "Other" last. "Other" opens an `input`. With no `options`, it shows an `input` with `recommended` as the prefill. If the dialog closes with no answer, the tool tells the agent to ask again or to stop the stage.
- `classify_change` (input: `type`, `size`, `reason`) is active only in Stage 1. It writes the type and the size to `state.json`. It rejects a `feature` in the small size, and a change to small after G1.
- `request_return` (input: `stage`, `reason`, `size?`) records a return. When the session is idle, `return-change` applies the return rule of the workflow document, and the loop continues from the target stage. `size: "full"` changes a small change to full.

### 4.5 Ship

1. Code merges the base branch into the change branch. If a conflict occurs, the run stops and tells the person to resolve it, commit, and run `/sdd`.
2. `ship-apply` does steps 2–5 of the workflow document: the stale check, the final IDs, and the delta applied to the area specs. If the stale check fails, the runner returns the change to Stage 1.
3. Code runs the full tier.
4. The review session writes the prose of `outcome.md` and calls `report_review` (input: `findings`, a list of `{ file, problem, action, returnTo }`). Code writes the findings table and the ID map into `outcome.md`.
5. If there are findings, the runner increases `reviewRounds`. It returns the change to the earliest stage that a finding names. After 2 rounds with findings, the remaining findings go to the G3 message, and the person decides.

### 4.6 Resume: `/sdd` with no arguments

1. The current branch must start with `sdd/`, and its change folder must exist. If not, the runner shows a toast.
2. If the tree is clean, the runner merges the base branch first. If not (the app quit during a stage), it does not merge now. The exit check commit of that stage cleans the tree, and the next stage merges.
3. If the exit check of the current stage passes, the runner goes directly to the gate. If not, it opens a new session of the stage with the message "Continue the stage. Read the files to see what is done."
4. If the change is `done` and a file that G3 covers changed after the merge of the base branch, G3 opens again, and Ship runs again from step 2.

## 5. Formats

### 5.1 Strict parts

Code parses only these parts. All other text is free prose.

| File | Strict parts |
|---|---|
| `spec.md` | `### US1 — <title> (P1)` · `- [US1-S1] Given …, When …, Then …` · `## Delta` with `### sdd/areas/<area>.md` and the lines `- ADDED NEW-R1: …`, `- MODIFIED FAV-R-002: …` + `(was: …)`, `- REMOVED FAV-R-003: …` + `(why: …)` · `## Baseline (from code)` with `- BASE-R1: …` + `Intended? yes \| no` · `- [OPEN] …` |
| area spec | `Prefix: FAV   Next IDs: FAV-R-006, FAV-Q-003` · `- FAV-R-001: … (since <folder>)` · `## Tests` with `- <ID> → <test name>` · `## History` · `## Coverage` |
| `traceability.md` | Fixed columns: `ID \| Scenario \| Level \| Test \| Status \| Evidence \| Verdict` |
| `plan.md` | Task lines: `- [ ] T001 (test) [P] [ID, ID] <text> in <file>` |
| `rules.md` | The Commands section (5.3) |
| `state.json` | JSON (5.2) |

The small size uses the same spec format with fewer sections. It has one story, `US1`, so its scenario IDs are `US1-S1`, `US1-S2`. A small `bug` or `change` adds one strict line, `Requirement: <ID>`, which the stale check uses.

### 5.2 `state.json`

```json
{
  "owner": "Sam",
  "base": "main",
  "size": "full",
  "type": "feature",
  "specVersion": 2,
  "stage": "build",
  "reviewRounds": 0,
  "gates": [
    { "gate": "G1", "result": "approved", "commit": "3f2a91c", "by": "Sam", "at": "2026-10-08" },
    { "gate": "G2", "result": "approved", "commit": "c19d5e2", "by": "Sam", "at": "2026-10-11" }
  ]
}
```

### 5.3 Commands section of `rules.md`

```markdown
## Commands
- Full tier: npm test
- JUnit reports: reports/*.xml
- Fast tier: npx vitest run --changed
- Test files: **/*.test.ts, e2e/**/*.e2e.ts
- Mutation: npx stryker run | none
- Inner TDD: optional
- Merge method: pull request on GitHub
```

- The full tier must write the JUnit reports. Code runs only the full tier.
- The fast tier is for the agent in Build.
- The mutation command must exit with 0 only if the score is at the minimum or higher.
- The merge method is for the person. The runner does not use it.

### 5.4 Traceability

- A JUnit test case matches a row if its name or its class name contains the text in the *Test* column, for example `favorites-sorting-us1-s1`.
- Characterization tests use the level `Characterization`.
- The agent fills *Level*, *Test*, *Evidence*, and the **extra** rows.
- Code fills *Status* from the JUnit report: `failing (expected)`, `passing`, `failing`, `skipped`, or `not found`.
- Code sets *Verdict*: `met` if the test passes and the *Evidence* file exists, else `missing`. The agent sets `extra`. There is no `partly`: a test that passes while the requirement is only partly met is a weak test, so the agent uses `request_return` to Stage 3.

## 6. Exit checks

| Stage | Passes when |
|---|---|
| Setup | `rules.md` parses. The full tier runs, and each JUnit report exists and parses. |
| 1 Spec | `spec.md` parses. No `[OPEN]` line remains. `classify_change` was called. A feature is full, and a small delta is empty or has one MODIFIED item. A dry run of the delta against the area specs passes: each MODIFIED and REMOVED ID exists. |
| 2 Plan | `plan.md` parses. Each delta ID is in a task. Each scenario ID is in a `(test)` task. No two `[P]` tasks in one phase name the same file. |
| 3 Tests | Each scenario and each delta ID has a row. Each `(test)` task is ticked. In the full tier, each new or changed test fails, each characterization test passes, and no test of a REMOVED row remains. For `refactor` and `chore`, each test passes instead, because the behavior must not change. |
| 4 Build | Each task is ticked. In the full tier, each row's test passes, and none is skipped. Each *Evidence* file exists. No **extra** row remains. The mutation command, if set, exits with 0. |
| 5 Ship | `ship-apply` passed. The full tier passes. `report_review` was called in this round. `outcome.md` has the sections Delivered, Evidence, Changed after approval, ID map, Review, and Left open. |

The person checks what code cannot check at the gates: "fails for the correct reason", the rules exceptions, and the code quality.

## 7. Enforcement

### 7.1 Tools for each stage

| Stage | Active tools | The agent can write |
|---|---|---|
| Setup | read, grep, find, ls, write, edit | `sdd/rules.md` |
| 1 Spec | read, grep, find, ls, write, edit, `ask_owner`, `classify_change` | its `spec.md` |
| 2 Plan | read, grep, find, ls, write, edit, `request_return` | its `plan.md` |
| 3 Tests | read, grep, find, ls, bash, write, edit, `request_return` | test files, its `traceability.md`, the ticks in its `plan.md` |
| 4 Build | read, grep, find, ls, bash, write, edit, `request_return` | everything except the protected paths |
| 5 Review | read, grep, find, ls, write, edit, `report_review` | its `outcome.md` |

The model has no tool to approve a gate.

### 7.2 Protected paths

In every stage, the agent cannot write:

- `state.json`;
- `sdd/areas/**` (only `ship-apply` writes it);
- `sdd/rules.md`, except in Setup;
- the folders of other changes;
- `spec.md` after G1;
- the approved tests after G2.

The approved tests are the files that match the `Test files` globs and that the branch changed between `base` and the G2 commit. Code computes this list from git.

`pi-guard.ts` blocks `write` and `edit` calls to these paths. The block reason names the paths that the stage can write.

### 7.3 Writes through bash

The `tool_call` guard cannot see the files that a bash command writes. After each stage session, code runs `git diff` on the protected paths against the last commit. If a protected file changed, the check fails and names the file. Code restores the file from the commit, and the follow-up message tells the agent to use `request_return`. The gate status check (G1 covers `spec.md`, G2 covers `spec.md` and the approved tests, G3 covers the full diff except `state.json`) also finds a later change.

### 7.4 Commits

- The runner commits only on the change branch, with the git user that the project has.
- It commits after each passed exit check, and at each gate approval. If a gate approval has no new work to commit, the approval records the last commit.
- The commit message has the form `sdd(<slug>): <event>`, for example `sdd(favorites-sorting): G1 approved`.
- The `by` field of an approval is `git config user.name`.

## 8. Errors

| Case | What the runner does |
|---|---|
| The person stops the agent (Esc) | The run stops with no follow-up message. `/sdd` resumes later. |
| A gate dialog closes with no answer | Same as **Stop**. |
| A command runs longer than 30 minutes | `shell.ts` stops it. The exit check fails with the output. |
| A JUnit report is missing after the full tier | The exit check fails and names the glob. |
| An exit check fails 3 times | The person selects **Try again** or **Stop**. |
| A merge conflict | The run stops. The person resolves it, commits, and runs `/sdd`. |
| A git command fails | The run stops. The toast shows the command and its output. |
| The app quits during a stage | The files and the commits stay. `/sdd` resumes. |

Each thrown error names the operation and the value that failed, with the original error as `cause`.

## 9. Tests

### 9.1 Entities (Vitest, pure, string fixtures)

| File | Main cases |
|---|---|
| `delta.ts` | Each line form. A missing `(was: …)`. A duplicate ID. A small delta with more than one item. |
| `area-spec.ts` | Apply ADDED, MODIFIED, and REMOVED. *Next IDs* increases. A REMOVED ID is never used again. The stale check finds changed text. `BASE-*` items. |
| `traceability.ts` | Match by "contains". Status from test cases. A skipped test is not passed. `met` and `missing`. REMOVED rows. Characterization rows. |
| `plan.ts` | Task line forms. The consistency check. Two `[P]` tasks with the same file. |
| `state.ts` | The gate status comes from the last entry. `reopened`. The targets of the return rule. |
| `rules.ts` | Each command line. A missing full tier. `Inner TDD` defaults to `optional`. |
| `write-policy.ts` | One table-driven test: each stage × each path kind → allowed or blocked. |

### 9.2 Adapters

- `junit.ts`: real report files from Vitest, Jest, Playwright, pytest, and Maestro, kept as fixtures.
- `git.ts`: a real repository in a temporary folder. Branch, commit, merge of the base, "changed since commit", and a merge conflict.
- `shell.ts`: the timeout stops the command.
- `pi-guard.ts` and `pi-tools.ts`: the pattern of `packages/tenon-canvas/src/extension.test.ts`, with a fake context. `classify_change` rejects a feature in the small size.

### 9.3 Runner (`run-change.test.ts`)

A real temporary repository, a fake `Agent` that writes the files of each stage, and a fake `Person` with scripted answers. The full tier is a small Node script that writes a JUnit report.

1. The full size from start to `done`. The area spec has the final IDs, and the commits exist.
2. The small size: no Plan, and only G3.
3. The gate answer **Change** starts a new session, and the gate runs again.
4. A return from Build to Tests reopens G2 and G3.
5. The agent writes an area spec through bash. The check fails, and code restores the file.
6. The agent edits an approved test in Build. The guard blocks the edit. A bash edit is restored.
7. The base branch changes FAV-R-002 before Ship. The stale check returns the change to Spec.
8. Stop at G2, then a new runner instance. The runner goes directly to G2.

### 9.4 Tenon and the real model

- `npm run typecheck` and all existing tests pass.
- One manual run on a small sample project with a real model before v1 is done. Record the cost, the number of questions, and the result. This is not part of `npm test`.

## 10. Changes to the workflow document

The implementation copies the workflow document into `packages/tenon-sdd/WORKFLOW.md` and makes these changes. The guides follow the copy.

1. `base` replaces "main branch": the base is the branch where the person ran `/sdd`.
2. Stage 1 has the tool `classify_change`. The agent sets the type and the size with it.
3. The small size uses the same spec format as the full size, with one story (`US1`) and the line `Requirement: <ID>` for a bug or a change.
4. *Verdict* is `met`, `missing`, or `extra`. `partly` is removed.
5. A gate answer **Change** starts a new stage session with the feedback.
6. `rules.md` has one full tier command that writes the JUnit reports.
7. `rules.md` has the new lines `JUnit reports`, `Test files`, and `Inner TDD`.
8. The runner never merges. The person merges after G3.
9. The runner commits after each passed exit check, so the tree is clean when it merges the base branch at the start of each stage.
10. A slug is unique across all change folders, so the test names stay unique.
11. The owner is `git config user.name`.

## 11. Not in v1

- Worktrees and more than one change at a time. Later, with a change to `assertProject` that accepts a git worktree inside a known project, a git-ignored `.worktrees/` folder, and a `Worktree setup` line in `rules.md`. The workflow rules use only the branch name, so they do not change.
- Push, pull requests, and merge.
- A check of the approver's identity.
- A code check of the inner TDD loop.
- A model for each stage, and a question budget.
- A parser for mutation scores. The mutation command reports with its exit code.
- A full XML parser. `junit.ts` reads test cases and their `failure`, `error`, and `skipped` children. ponytail: a small parser; use an XML library if a test tool writes JUnit that it cannot read.
- A Tenon review page or progress panel.
