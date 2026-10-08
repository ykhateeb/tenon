# Stage 3: Tests

You write the tests before the code exists. Do not write production code in this stage: the runner blocks writes to files that are not test files, `traceability.md`, or `plan.md`.

## Steps

1. Read `spec.md`, `plan.md` (the contracts, the test data, and the `(test)` tasks), and `sdd/rules.md` (Test files, Fast tier).
2. Existing code only: write characterization tests for the baseline items that the change must not change. They must pass on the current code. Use the level `Characterization` in `traceability.md`. Do not write a characterization test for a defect item: write a failing test for it.
3. For each scenario, write one test at the lowest level that proves it:
   - E2E for the main path of each P1 story, and for a few failure paths that the user sees (empty, offline, error).
   - Integration for the data layer, API handling, and state changes.
   - Unit for business rules, calculations, and variations of one rule.
4. Put a tag in the name of each scenario test: the slug and the scenario ID in lower case, for example `favorites-sorting-us1-s1`. The slug is the part of the change folder name after the date. The runner finds the test in the JUnit report by this tag.
5. Write the tests for the quality requirements (NEW-Q items) and one contract test for each API or event in the plan.
6. If a requirement is MODIFIED, change its old tests to the new behavior, or delete them if a new test replaces them. If a requirement is REMOVED, delete its old tests.
7. Run the fast tier from `sdd/rules.md`. Each new or changed test must fail because the feature is missing, not because the test is broken.
8. Write `traceability.md` (format below). Fill ID, Scenario, Level, and Test. Leave Status, Evidence, and Verdict empty: the runner fills Status.
9. Tick the `(test)` tasks in `plan.md`.
10. If a scenario cannot be tested as written, call `request_return` with the stage spec.
11. Stop. The runner runs the full tier and checks each row.

## Small size

- Bug or change: write one failing test for the scenario.
- Refactor or chore: make sure that tests cover the requirements in "Must not change". If the coverage is weak, add tests that pass on the current code.
- One row in `traceability.md` for each test.

## Format of traceability.md

```markdown
# Traceability: <title>
| ID | Scenario | Level | Test | Status | Evidence | Verdict |
|---|---|---|---|---|---|---|
| NEW-R1 | US1-S1 | E2E | e2e/<slug>-us1-s1 |  |  |  |
| FAV-R-002 | US2-S1 | E2E | e2e/<slug>-us2-s1 (replaces e2e/<old tag>) |  |  |  |
| NEW-Q1 | Performance | Unit | logic/<slug>-sort-perf |  |  |  |
| GET /items | Contract | Contract | contracts/<slug>-items |  |  |  |
| FAV-R-003 | REMOVED | — | e2e/<old tag> deleted |  |  |  |
```

- The Test column holds the path and the tag. The runner uses the last path part of the first word, for example `<slug>-us1-s1`.
- Each scenario and each delta ID needs a row.
- A REMOVED row has the Scenario `REMOVED` and the old tag followed by "deleted".
