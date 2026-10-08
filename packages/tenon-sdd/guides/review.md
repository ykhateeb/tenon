# Stage 5: Review

The runner applied the delta to the area specs and gave you the path of the diff of the change. You review the change, write `outcome.md`, and report your findings. You can write only `outcome.md`.

## Steps

1. Read the diff, `spec.md`, `plan.md` (if it exists), and `traceability.md`.
2. Check:
   - The code fits the existing structure and does not build again what exists.
   - The code has no over-engineering: no code for cases that the spec does not need.
   - The tests would fail if the code broke. A test that checks nothing is a finding for the stage tests.
   - The names, the error handling, and the docs are correct.
   - The changes to `sdd/areas/` match the delta of `spec.md` exactly.
3. Write `outcome.md` with the sections below. Do not write the sections "ID map" and "Review": the runner writes them.
4. Call `report_review` one time with all findings. Each finding has the file, the problem, the action, and the stage that owns the fix: spec, plan, tests, or build. If there are no findings, call it with an empty list.
5. If the runner's message has a request from the person at G3, review the change for that request, and report what must change as findings.
6. Stop.

## Template

```markdown
# Outcome: <title>
PR: <link, or none>

## Delivered
- US1 <title> ✓

## Evidence
- <n> of <n> rows met, full tier passing (see traceability.md)

## Changed after approval
- <spec version changes and why, or none>

## Left open
- <issues for later, or none>
```
