# tenon-sdd

This folder is a pi package: the `/sdd` runner for spec-driven changes (`src/extension.ts`) and one guide for each stage (`guides/`). It works in Tenon and in terminal pi. The design is `docs/superpowers/specs/2026-10-08-tenon-sdd-design.md`. The workflow that it runs is `WORKFLOW.md`.

## Layers

- `src/entities/`: pure rules on strings and plain data. No pi, no fs, no git. Imports only `entities/`.
- `src/use-cases/`: the actions of the workflow. Imports `entities/`, `use-cases/`, and `adapters/git.ts`, `adapters/shell.ts`, `adapters/junit.ts`.
- `src/adapters/`: git, the shell, JUnit, and pi. Imports `entities/` types, `use-cases/ports.ts`, `use-cases/stages.ts`, pi, and node.
- `src/extension.ts`: the composition root. The only file that imports all layers.
- `src/testing/`: helpers for tests. Production code never imports them.

## How Tenon uses the package

- `src/core/sessions/runtime.ts` imports the extension (`#sdd/extension`) and passes `guidesDir`. The agent build bundles it into `out/main/agent.js`.
- Tenon reads `packages/tenon-sdd/guides/` from disk. If you move the folder, change `runtime.ts` and `electron-builder.yml` too.
- `src/renderer/src/chat/Chat.tsx` shows the `sdd-gate` custom message as Markdown.
- `ctx.newSession()` makes Tenon load a new instance of this extension for each stage session. The stage session reads its stage from the `sdd-stage` custom entry, and the tools report through custom entries.

## Code rules

- Use relative imports with the `.js` suffix. Terminal pi loads the package without the `#` aliases of the app.
- Keep state in `create…()` factories, not at module level.
- Tests that need files use `mkdtempSync(join(tmpdir(), "tenon-sdd-"))`.
