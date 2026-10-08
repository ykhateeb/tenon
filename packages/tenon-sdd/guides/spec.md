# Stage 1: Spec

You write `spec.md` in the change folder. The spec tells what the user needs and why. It contains no technology words. The runner gave you the change folder and the request. The runner already made the branch, the folder, and `state.json`. You can write only `spec.md`.

## Steps

1. Read `sdd/rules.md` and the area specs in `sdd/areas/` that the request touches.
2. Select the type and the size, and call `classify_change`:
   - feature: new behavior. Always full size.
   - change: changes a requirement that is in an area spec.
   - bug: the code breaks a requirement that is in an area spec. The delta is empty. If no requirement covers the case, the type is change.
   - refactor or chore: no behavior change. The delta is empty.
   - docs: text only. The delta is empty.
   - Small size: one changed requirement or no behavior change, a few files, no new data, no API change. All other changes are full size.
3. If an area spec does not describe the behavior that the change touches, read the code and write a baseline (see "Existing code").
4. Write the goal: the problem, who has it, and why it is important.
5. Split the change into user stories, each with a priority (P1 = necessary). A small change has one story, US1.
6. For each story, write acceptance scenarios as Given / When / Then. Each "Then" must be visible or measurable.
7. Write the delta. A new requirement gets NEW-R1, NEW-R2, and a new quality requirement gets NEW-Q1. Do not write final IDs: Ship gives them. For a new area, write the heading with "(new, prefix ABC)", where ABC is 2 to 8 capital letters.
8. Use the quality checklist. Give each item a measurable target, "rules default", or "N/A + reason". A target that needs a test is a NEW-Q item in the delta.
9. Write the edge cases and the items that are out of scope.
10. For each unclear item, call `ask_owner`: one question at a time, with 2 to 4 options and your recommendation. Write the answer into the requirement that it affects, and record it in Decisions. While a question is open, keep it as a line `- [OPEN] <question>`. No `[OPEN]` line can remain at the end.
11. Stop. The runner checks the spec. If the check fails, you get a message: correct the spec.

## Strict lines

The runner reads these lines. Write them exactly in this form. All other text is free.

- `### US1 — <title> (P1)`
- `- [US1-S1] Given …, When …, Then …`
- Under `## Delta` and `## Baseline (from code)`: `### sdd/areas/<area>.md`, or `### sdd/areas/<area>.md (new, prefix ABC)`
- `- ADDED NEW-R1: <text>`
- `- MODIFIED FAV-R-002: <new text>`, and on the next line `(was: <old text, exactly as in the area spec>)`
- `- REMOVED FAV-R-003: <text, exactly as in the area spec>`, and on the next line `(why: <reason>)`
- In the baseline: `- BASE-R1: <behavior>`, and on the next line `Intended? yes` or `Defect: <what the code does>. Intended? no`
- In the baseline: `Coverage: <parts of the area that have no spec yet>`
- `- [OPEN] <question>`
- Small bug or change: `Requirement: <ID>`

## Template (full size)

```markdown
# Spec: <title>
Areas: <area> (sdd/areas/<area>.md)

## Goal
<the problem, who has it, and why it is important>

## User stories
### US1 — <title> (P1)
As a <user>, I want <action>, so that <value>.
- [US1-S1] Given <start state>, When <action>, Then <visible result>

## Delta
### sdd/areas/<area>.md
- ADDED    NEW-R1: <new behavior>
- ADDED    NEW-Q1: <measurable quality target>
- MODIFIED <ID>: <new text>
    (was: <old text>)
- REMOVED  <ID>: <text>
    (why: <reason>)

## Quality checklist
- Performance: <NEW-Q item, rules default, or N/A + reason>
- Security: <…>
- Privacy: <…>
- Reliability: <…>
- Accessibility: <…>
- Compatibility: <…>

## Edge cases
- <what happens when …>

## Out of scope
- <what this change does not do>

## Decisions
- <date> Q: <question> A: <answer>. Changed: <IDs>
```

## Template (small size)

```markdown
# Spec: <title>
Area: <area>   Requirement: <ID of the broken or changed requirement>
Current: <what happens now>
Expected: <what must happen>
Must not change: <IDs>

## User stories
### US1 — <title> (P1)
- [US1-S1] Given …, When …, Then …

## Delta
none
```

For a small change of one requirement, write one MODIFIED item under `## Delta`, with its area heading and its `(was: …)` line. For a refactor or chore, write "Expected: no behavior change". For docs, write only the reason, one story, and "none" under `## Delta`.

## Existing code

If the area spec does not describe the behavior that the change touches:

1. Read the code. Under `## Baseline (from code)`, write the current behavior that the change touches as BASE items.
2. For each item, call `ask_owner`: "Is this behavior intended?"
   - If yes, write `Intended? yes` below the item. A change to it is a MODIFIED item in the delta, with the BASE ID.
   - If no, write the intended behavior as the item, and below it `Defect: <what the code does>. Intended? no`. The fix needs no delta item, only a failing test.
3. Add one `Coverage:` line that names the parts of the area that have no spec yet.
