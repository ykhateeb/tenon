import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GateAnswer, Person } from "../use-cases/ports.js";
import type { PiAgent } from "./pi-agent.js";

// Tenon's src/renderer/src/chat/Chat.tsx repeats this literal: the package cannot import #protocol, and the renderer cannot import the package.
export const GATE_MESSAGE = "sdd-gate";
const APPROVE = "Approve";
const CHANGE = "Change";
const STOP = "Stop";

/** The person through the dialogs of the newest session. Tenon shows the sdd-gate message as Markdown. */
export function createPiPerson(pi: ExtensionAPI, agent: PiAgent): Person {
  const ui = () => agent.context().ui;
  return {
    async gate(question, summary): Promise<GateAnswer> {
      await showSummary(pi, agent, summary);
      const choice = await ui().select(question, [APPROVE, CHANGE, STOP]);
      if (choice === APPROVE) return { kind: "approve" };
      if (choice !== CHANGE) return { kind: "stop" };
      const feedback = (await ui().input("What must change?", ""))?.trim();
      return feedback ? { kind: "change", feedback } : { kind: "stop" };
    },
    choose: (title, options) => ui().select(title, options),
    input: (title, hint) => ui().input(title, hint),
    notify: (message, level) => ui().notify(message, level),
  };
}

/** Before the first stage session, the start chat is current, and the pi object of this instance can still show messages. */
async function showSummary(pi: ExtensionAPI, agent: PiAgent, summary: string): Promise<void> {
  const message = { customType: GATE_MESSAGE, content: summary, display: true };
  const session = agent.stageSession();
  if (session) await session.sendMessage(message);
  else pi.sendMessage(message);
}
