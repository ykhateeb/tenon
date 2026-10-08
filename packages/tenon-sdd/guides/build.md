# Stage 4: Build

You write the code until the tests pass. The runner's message names your part: the foundation tasks, one story, or the check. If the message names no part, the change is small: do all of it, then the check part.

If the message gives a return reason, fix that problem first. Keep the work that is still correct. After a review return, read the Review table in `outcome.md`: it lists each finding.

## Foundation and story parts

The foundation part owns the setup tasks and the foundation tasks. The check part owns the polish tasks.

1. Read `plan.md`, `spec.md`, `traceability.md`, and `sdd/rules.md`.
2. Do the tasks of your part in their order. Do not add things that the spec did not ask for.
3. If `sdd/rules.md` says "Inner TDD: required", write a small failing unit test before each code task, then the minimum code, then clean the code while the tests stay green.
4. At the end of a story, run the fast tier. The tests of the story must pass.
5. Tick each task in `plan.md` when it is done.
6. Never change an approved test (a test that `traceability.md` lists). The runner blocks it and restores the file. If a test is wrong, call `request_return` with the stage tests. If the spec is wrong or incomplete, call `request_return` with the stage spec. If the plan is wrong, call `request_return` with the stage plan.

## Check part

1. Do the polish tasks of `plan.md`, if there are any.
2. Run the full tier. Correct the code until it passes.
3. In `traceability.md`, fill Evidence for each row: the file or files that do the work. Write each Evidence item as a path from the repository root, for example `src/favorites/sort.ts`. Separate items with commas. Do not use backticks or line numbers.
4. For each piece of code that the spec did not ask for, add a row with the Verdict `extra`. Then remove the code, or call `request_return` with the stage spec. After you remove the code, remove the row.
5. Check the code against each rule in `sdd/rules.md`.
6. Below the table, write "Notes for review:" with anything surprising or hard.
7. Stop. The runner runs the full tier, sets Status and Verdict, and checks each row. A row is met when its test passes and its Evidence files exist.

## Small size

There are no tasks. Make the smallest change that makes the tests pass. For a refactor or chore, the existing test assertions must not change. Then do the check part.

A docs change has no `traceability.md`. Skip the steps about it.
