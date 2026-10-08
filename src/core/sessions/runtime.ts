import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  hasTrustRequiringProjectResources,
  type ModelRuntime,
  ProjectTrustStore,
  type SessionManager,
} from "@earendil-works/pi-coding-agent";
import { DIALOG_CANCELLED, type Send, type TrustAnswer } from "#protocol";
import { settingsWithoutMissing } from "#core/packages";
import tenonCanvas from "#canvas/extension";
import tenonSdd from "#sdd/extension";
import type { Dialogs } from "./extension-ui";

/** Project trust, and pi runtimes that load a project's own files only when it is trusted. */
export function createRuntimes({ send, modelRuntime, ask }: { send: Send; modelRuntime: ModelRuntime; ask: Dialogs["ask"] }) {
  // "Open without project files" answers, for this app run only.
  const trustOnce = new Map<string, boolean>();

  // pi also uses this for the sessions a runtime replaces itself with (fork, new, switch).
  const factory: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const trusted = new ProjectTrustStore(getAgentDir()).get(cwd) ?? trustOnce.get(cwd) ?? false;
    const { settingsManager, missing } = settingsWithoutMissing(cwd);
    if (missing.length) send({ type: "notify", level: "warning", message: `Not installed, so not loaded: ${missing.join(", ")}. Install them in Packages.` });
    const services = await createAgentSessionServices({
      cwd,
      modelRuntime,
      settingsManager,
      // Tenon ships the design canvas and the sdd runner itself: no `pi install` needed. Bundle is out/main/agent.js.
      resourceLoaderOptions: {
        extensionFactories: [
          { name: "tenon-canvas", factory: tenonCanvas },
          { name: "tenon-sdd", factory: (pi) => tenonSdd(pi, { guidesDir: join(import.meta.dirname, "../../packages/tenon-sdd/guides") }) },
        ],
        additionalSkillPaths: [join(import.meta.dirname, "../../packages/tenon-canvas/skills")],
      },
      resourceLoaderReloadOptions: { resolveProjectTrust: async () => trusted },
    });
    return {
      ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  return {
    /** Ask once for a folder with .pi/ extensions, skills or prompts. If the user cancels, it throws DIALOG_CANCELLED. */
    async ensureTrust(cwd: string) {
      const store = new ProjectTrustStore(getAgentDir());
      if (!hasTrustRequiringProjectResources(cwd) || store.get(cwd) !== null || trustOnce.has(cwd)) return;
      const answer = await ask<TrustAnswer | undefined>({ method: "trust", cwd, files: piFiles(cwd) }, undefined);
      if (!answer) throw new Error(DIALOG_CANCELLED);
      if (answer === "trust") store.set(cwd, true);
      else trustOnce.set(cwd, false);
    },

    create: (cwd: string, sessionManager: SessionManager) => createAgentSessionRuntime(factory, { cwd, agentDir: getAgentDir(), sessionManager }),
  };
}

/** Board 1's trust dialog: what the project's .pi folder holds. */
function piFiles(cwd: string) {
  try {
    return readdirSync(join(cwd, ".pi"), { withFileTypes: true }).map((e) => {
      if (!e.isDirectory()) return { name: `.pi/${e.name}` };
      const n = readdirSync(join(cwd, ".pi", e.name)).length;
      return { name: `.pi/${e.name}/`, detail: `${n} ${n === 1 ? "item" : "items"}` };
    });
  } catch {
    return [];
  }
}
