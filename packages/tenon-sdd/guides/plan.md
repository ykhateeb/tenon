# Stage 2: Plan

You write `plan.md` in the change folder: the technical approach and the task list. All technology choices are in the plan, not in the spec. You can write only `plan.md`.

If the message gives a return reason, fix that problem first. Keep the work that is still correct.

## Steps

1. Read `spec.md`, `sdd/rules.md`, and the code that the change touches.
2. Write the technical context: stack, platforms, and constraints.
3. List the existing code to reuse, so that nobody builds it again.
4. Check each new dependency: is it maintained, is the license correct, and does it have known security problems?
5. Write the data model, the contracts (API shapes, events, UI test IDs), and the test data (named fixtures).
6. Write the security and privacy check, and the compatibility and migration plan.
7. Record each decision: what, why, and what you did not select.
8. Write the tasks. Use the phases that you need, in this order: setup, foundation, one phase for each story (by priority), polish.
9. Mark each test task with `(test)`. Stage 3 does the test tasks before the build. Stage 4 does the other tasks.
10. Give each task the IDs that it serves in brackets, and the file at the end after "in". Mark tasks that can run in parallel with `[P]`. Two parallel tasks in one phase must not change the same file.
11. Check: each delta ID (ADDED, MODIFIED, and REMOVED) is in a task, and each scenario ID is in a `(test)` task. Each rule of `sdd/rules.md` holds, or the exception is written with a reason.
12. If the spec is wrong or incomplete, call `request_return` with the stage spec.
13. Stop. The runner checks the plan.

## Task line format

`- [ ] T001 (test) [P] [US1-S1, NEW-R1] <what to do> in <file>`

`(test)` and `[P]` are optional.

## Template

```markdown
# Plan: <title>
Spec: version <specVersion in state.json>

## Technical context
<stack, platforms, storage, test tools, constraints>

## Reuse and dependencies
- Reuse: <module> for <purpose>
- New dependency: <name> — maintained? license? security?

## Data model
<entity>: <fields, states, rules>

## Contracts
- <API shape or event>
- UI test IDs: <id> (<scenario IDs>)

## Security and privacy
- Data touched: <…>   Threats: <…> → <prevention>

## Compatibility and migration
- <how old data and old callers keep working>

## Test data
- Fixture <name>: <the state that it makes> (<scenario IDs>)

## Decisions
- <decision> | Why: <…> | Not selected: <…>

## Rules exceptions
- none

## Tasks
### Phase 1 — Foundation
- [ ] T001 (test) [<contract>] Contract test in <file>
- [ ] T002 [NEW-R1] <task> in <file>

### Phase 2 — US1 <title> (P1)
- [ ] T003 (test) [US1-S1] E2E test in <file>
- [ ] T004 [US1-S1] <task> in <file>
Checkpoint: US1 works alone and its tests pass
```
