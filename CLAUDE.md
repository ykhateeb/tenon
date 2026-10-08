# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Tenon is an Electron desktop app for pi (`@earendil-works/pi-coding-agent`), a coding agent. It is built with electron-vite, React 19, and Tailwind 4.

## Commands

- `npm run dev`: start the app with hot reload.
- `npm run typecheck`: run `tsc` on `src/`, `packages/`, and `e2e/`. No lint tool exists.
  - `tsc` does not report unused imports. After you move code, remove unused imports by hand.
- `npm test`: run all Vitest unit tests (`*.test.ts` in `src/` and `packages/`).
  - One file: `npx vitest run src/core/sessions/tree.test.ts`. One test: add `-t "<name>"`.
- `npm run test:e2e`: run the Playwright tests (`e2e/*.e2e.ts`, `packages/*/e2e/*.e2e.ts`).
  - `e2e/tenon.e2e.ts` launches the built app. Run `npm run build` before it.
  - `packages/tenon-canvas/e2e/` runs the canvas server in the test process and drives it with Chromium. It needs no build.
  - One e2e test: `npx playwright test -g "<part of the title>"`.
- `npm run dist`: build and package the app with electron-builder.

## Dev environment variables

- `TENON_DIR` (default `~/.tenon`) and `TENON_PI_DIR` (default `~/.pi/agent`): set both to a temp folder to keep a test run away from real data. The e2e tests do this.
- Open the app on a given view with no clicks. Main puts these in the URL hash, and `src/renderer/src/store.ts` reads them:
  - `TENON_OPEN=latest|<part of a title>` opens a session. Add `TENON_VIEW=tree` to show its tree.
  - `TENON_SEARCH=<text>`, `TENON_TAB=sessions|packages|settings`, `TENON_DIALOG=provider|import`.
- `npm run gallery` (`TENON_GALLERY=1`): show the UI design system page (`src/renderer/src/ui/Gallery.tsx`). `TENON_GALLERY=open` also opens its menu and dialog.
- `TENON_NO_OPEN=1`: the canvas extension does not open a browser.
- `TENON_HIDE_WINDOW=1`: the app window does not show. `e2e/tenon.e2e.ts` sets it, so a test run does not take the focus. Set `TENON_HIDE_WINDOW=0` to watch a run.

## Architecture

The app has three processes:

1. **Main** (`src/main/`): owns the window, native dialogs, and the host IPC (`host-ipc.ts`). It forks the agent process and gives the window a direct `MessagePort` to it (`agent-host.ts`). Main does not relay agent traffic.
2. **Agent** (`src/agent/index.ts`, an Electron `utilityProcess`): pi and all pi extensions run here, never in the window. `createHandle()` (`src/agent/handlers.ts`) dispatches each window command to its handler in `src/agent/<area>-commands.ts`. The logic lives in `src/core/`. `src/core/sessions/registry.ts` holds the open pi sessions and their commands. Next to it: `runtime.ts` (project trust, pi runtime creation), `live-state.ts` (the `LiveState` of a session), `move.ts` (moving a session to a project).
3. **Renderer** (`src/renderer/src/`): React UI. `store.ts` is one global store (`useSyncExternalStore`): state, `set()`, notices. `port.ts` sends commands (`call()`), and `agent-messages.ts` applies agent messages. Each feature folder has an `actions.ts`, and `actions.ts` joins them into the `actions` object that components use. Before you change the UI, read `src/renderer/CLAUDE.md`.

`src/protocol.ts` is the single source of truth for the window-to-agent contract: `Command` (window to agent, answered with a `reply` by `rid`) and `AgentOut` (agent to window).

### Add a window command

1. Add a variant to `Command` in `src/protocol.ts`. If the command answers with data, add its reply type to `DataReplies` there. `tsc` then checks the handler and the `call()` in the window.
2. Add its handler to the `<area>Commands()` map in `src/agent/<area>-commands.ts`. `tsc` fails until each `Command` type has a handler. For a new area, add a new file, and add its map to `createHandle()` in `src/agent/index.ts`.
3. Guard each value from the window (see "Trust model").
4. Add an action to `src/renderer/src/<feature>/actions.ts` that sends the command with `call()`.

### Add a host function

Main does the work that needs Electron's main process: native dialogs, the shell, and grants.

1. Add a method to the `host` object in `src/preload/index.ts`. The `Host` type comes from this object.
2. Add its `host:<name>` handler to `registerHostIpc()` in `src/main/host-ipc.ts`.
3. Give each argument the type `unknown`, and check it before use.

### Trust model

The window shows model output, so the agent and main treat each value from the window as untrusted. When you add a `Command` or a host function, guard each value from the window:

- A `cwd`: `assertProject` (`src/core/projects.ts`). A folder becomes a project only through main's folder picker.
- A session path: `sessionFile()` (`src/core/paths.ts`).
- A file path: `assertGranted("file", …)` (`src/core/grants.ts`). Main grants a file that the user picked or dropped, on its own channel to the agent.
- A package install or update: `consumePackageGrant(packageGrant(…))`. The user confirms in main's own dialog, and the grant is for one use.

### Data locations

- Tenon keeps its own pi agent folder at `~/.tenon/agent`. Main sets `PI_CODING_AGENT_DIR` to it.
- Tenon shares only `auth.json` with terminal pi. The import feature copies other items from `~/.pi/agent`.
- `src/core/paths.ts` reads `TENON_DIR` and `TENON_PI_DIR` when a module imports it. A test that touches these folders sets `process.env` first and then uses `await import(…)`. A static import uses the real `~/.tenon`.
- In the agent, `paths.ts` is the only module that reads the environment, and `settings.ts` holds the helpers that read and write the settings files. These two are the config modules.

### Build

- Main and agent share build chunks in `out/main/chunks/`. Code that uses `import.meta.dirname` must stay agent-only, or its relative path breaks.
- pi loads user and third-party extensions at runtime with jiti. Thus the main build does not bundle dependencies, and electron-builder unpacks `@earendil-works` from the asar.
- The agent build bundles the canvas extension into `out/main/agent.js`. Rebuild before the app e2e test sees an extension change.

### tenon-canvas package

`packages/tenon-canvas/` is a pi package: a design canvas extension and the `tenon-design` skill. Before you change the package, or host code that imports `#canvas/*`, read `packages/tenon-canvas/CLAUDE.md`.

### tenon-sdd package

`packages/tenon-sdd/` is a pi package: the `/sdd` runner for spec-driven changes and one guide for each stage. Tenon loads it in `runtime.ts` next to the canvas and passes `guidesDir`. `Chat.tsx` shows its `sdd-gate` message as Markdown. Before you change the package, read `packages/tenon-sdd/CLAUDE.md`.

## Code rules

### Principles

Follow Clean Code, Clean Architecture, and Effective TypeScript. The rules below apply them to this repo.

- **Dependency Rule:** `src/core/` imports no `electron`, `#renderer/*`, or `#preload` code. The renderer talks to the agent only through `#protocol`. pi is the platform of Tenon, not a detail: `src/core/` and `src/agent/` import pi directly, with no port.
- **Humble Object:** keep disk, network, and pi calls in a thin shell. Put the decisions in a pure function, so a unit test can call it with no disk.
- **DRY:** before you add code, look for a helper in this repo (see "Modules"), then in the Node stdlib, then in an installed dependency.

### Modules

- Keep state in a `create…()` factory (`createRegistry`, `createRuntimes`, `createGrants`, `createDialogs`), not at module level. `src/agent/index.ts` makes each one once and passes it on. Old exceptions, marked `ponytail:`: `projects.ts`, `attachments.ts`, `design.ts`, `providers.ts`.
- If a module gets a second job, split it by job, as in `src/core/sessions/`.
- Use the shared helpers. Do not copy them:
  - `readJson()`, `writeJson()`, `writePrivateJson()` (a file that can hold a key), `MODEL_SETTING_KEYS`: `src/core/settings.ts`
  - `manager()`, `resourceName()`: `src/core/packages.ts`
  - `availableModels()`: `src/core/providers.ts`
  - `contentText()`: `src/core/sessions/summary.ts`
  - `packageGrant()`, `GrantKind`: `src/core/grants.ts` (main uses them too)
  - `folderName()`: `src/renderer/src/chat/format.ts`

### Functions

- Write module-level helpers as `function` declarations. They are hoisted, so the exported functions can come first.
- A helper that shares state with its caller (as `fork` and `connect` in `src/main/agent-host.ts`) stays a closure inside the caller.
- Older functions with 3 or more positional parameters remain. Change one to an object parameter when you change its signature for another reason.

### Types

- Old uses of `any` remain in `packages/tenon-canvas/`. Write new code without `any`.
- Derive the window-to-agent types from `Command` and `AgentOut` in `#protocol`. Do not write a second copy of the shape.
- `src/protocol.ts` derives `AgentMessage` from the pi type `AgentSessionEvent`, so the window gets pi messages unchanged. The import is type-only, so no pi code loads in the renderer.
- Give each exported function an explicit parameter type. Let `tsc` infer its return type.

### Imports

- Use `./x` in the same folder. For any other folder, use a `#` alias from the `"imports"` field of `package.json` (`#protocol`, `#preload`, `#core/*`, `#renderer/*`, `#canvas/*`). Do not use `../`.
- `tsconfig.json` `paths` repeats the wildcard aliases, because `tsc` does not add `.ts`/`.tsx` to them. If you add an alias, change both files.
- The folders have no `index.ts` barrel files. A barrel would load `src/core/paths.ts` before a test sets `process.env` (see "Data locations"). It would also put agent-only code (`import.meta.dirname`) in the main build (see "Build").
- No tool enforces the layer boundaries. A reviewer checks each import against the Dependency Rule (see "Principles").
- Code in `packages/tenon-canvas/` does not use the aliases. Terminal pi loads it without this app.

### Tests

- Put a unit test next to its module, as `<module>.test.ts`.
- For files on disk, use a new temp folder from `mkdtempSync(join(tmpdir(), "tenon-<area>-"))`. For code that imports `src/core/paths.ts`, see "Data locations".
- The unit tests have no DOM. Test renderer logic as pure functions. Test the UI with the app e2e test or the gallery.

## Workflow

### Before you start a task

- Run `git fetch origin`, then look for changes that you did not pull: `git status -sb` shows `behind` for the current branch, and `git rev-list --count main..origin/main` counts the new commits on `main`.
- If there are such changes, get them first. Do not start work on an old copy. For the current branch: `git pull --ff-only`. For local `main` while you are on another branch: `git fetch origin main:main`.
- Make each new branch from the remote, not from local `main`: `git switch -c <type>/<topic> origin/main`.
- If the branch of your task is already on GitHub, pull its changes before you change it.

### Change size

- Each pull request is one self-contained change that works alone.
- Aim for 200 changed lines or fewer, tests included. Lockfiles, generated files, and deleted files do not count.
- Avoid pull requests above 400 changed lines. Allow a larger one only when:
  - a split would harm correctness or reviewability, or
  - the change is mechanical (a rename, a move, or a codemod).
- Do not remove tests or move them to a later pull request to make a pull request smaller. If the tests make it large, that is a valid exception.
- Put a mechanical change in its own commit, apart from the changes that you wrote by hand.
- For each exception, write in the description:
  - why you did not split the change,
  - the order to read the files,
  - the validation: the commands that you ran and their results, or the command that made the mechanical change.
- Ship small working parts. Each commit is one complete small cycle: the change, its tests, and a pass of `npm run typecheck`, `npm test`, and `npm run build`.
- Split a large task into a series of such commits. Commit each part before you start the next one.
- Put a refactor and a behavior change in different commits.

### Pull requests

- Do not commit directly to `main`. Make a branch for each task, push it, and open a pull request to `main`.
- One pull request has one topic. Its size follows "Change size".
- CI (`.github/workflows/ci.yml`) runs `npm run typecheck`, `npm test`, and `npm run build` on each pull request, and a merge to `main` needs it to pass. Run the same checks locally before you open or update a pull request. CI does not run the e2e tests: if you changed the agent or the UI, run `npm run test:e2e` locally after the build.
- The description follows `.github/pull_request_template.md`. Its parts are:
  - **Summary:** the problem, and what the change does about it.
  - **Changes:** how the change fixes it.
  - **Why this way:** why this fix, and each other option that you did not choose.
  - **How to verify:** steps for the reviewer.
  - **Checks:** the commands that you ran and their results, with each known failure and its cause.
  - **Behavior change:** "None", or each change marked `⚠`.
- Do not merge a pull request with a failing check, unless the description gives the failure and shows that the same failure occurs on `main`.

## Comments and commits

- Comments like "board 2c" or "board C12" refer to numbered design boards of the product spec. That spec is not in this repo.
- A comment tells why. The code tells what. If a comment repeats the code, delete the comment.
- Write comments and commit messages in short, plain English. Feature commit subjects name the step and boards (for example, "(step 9, board C12)"), and bullet lists follow.
- A `ponytail:` comment marks a deliberate simplification and states its limit.
