import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { AgentMessage, LiveState } from "#protocol";
import { actions } from "#renderer/actions";
import { useStore } from "#renderer/store";
import { TreeView } from "#renderer/tree/TreeView";
import { Segmented } from "#renderer/ui/controls";
import { Avatar, Button, cx, Kbd, Spinner } from "#renderer/ui/base";
import { Icon } from "#renderer/ui/Icon";
import { isTypingTarget } from "#renderer/ui/keys";
import { Menu, type MenuItem } from "#renderer/ui/Menu";
import { Composer } from "./Composer";
import { dayLabel, folderName, homePath, plural, time } from "./format";
import { ToolCard, type ToolResult } from "./ToolCard";

const EMPTY: AgentMessage[] = [];


function textOf(content: string | { type: string; text?: string }[]) {
  return typeof content === "string" ? content : content.map((c) => c.text ?? "").join("\n");
}

/** pi's turn: avatar on the left, name and text on the right (board 2). */
function Turn({ meta, children }: { meta?: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Avatar />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <b className="text-base">pi</b>
          {meta && <span className="text-xs text-muted">{meta}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Your turn: no avatar, right-aligned, a bordered bubble in the accent tint (board 2). */
function YouTurn({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[78%] flex-col items-end gap-1.5">
        <span className="text-meta text-muted">You</span>
        <div className="whitespace-pre-wrap rounded-[14px_14px_4px_14px] border border-accent-line bg-accent-bg px-3.5 py-2.5 leading-normal text-fg">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Board 1a: the message a search opened stays marked. `data-at` finds it. */
function Marked({ at, mark, children }: { at: number; mark?: number; children: ReactNode }) {
  return (
    <div data-at={at} className={at === mark ? "-mx-2 rounded-lg px-2 py-1 shadow-[0_0_0_1px_var(--color-accent-line)] bg-accent-bg" : undefined}>
      {children}
    </div>
  );
}

/** The content of one pi message, without its header. */
function AssistantParts({ m, results, running }: { m: Extract<AgentMessage, { role: "assistant" }>; results: Map<string, ToolResult>; running: Set<string> }) {
  return (
    <>
      {m.content.map((c, i) =>
        c.type === "text" ? (
          <div key={i} className="md text-sub"><Markdown>{c.text}</Markdown></div>
        ) : c.type === "thinking" ? (
          <details key={i} className="text-sm text-muted">
            <summary className="cursor-pointer">Thinking</summary>
            <div className="pt-1 whitespace-pre-wrap">{c.redacted ? "(redacted)" : c.thinking}</div>
          </details>
        ) : (
          <ToolCard key={c.id} call={c} result={results.get(c.id)} running={running.has(c.id)} />
        ),
      )}
      {m.errorMessage && <div className="text-danger">{m.errorMessage}</div>}
    </>
  );
}

function Message({ m, results, running }: { m: AgentMessage; results: Map<string, ToolResult>; running: Set<string> }) {
  switch (m.role) {
    case "user":
      return <YouTurn>{textOf(m.content)}</YouTurn>;
    case "assistant":
      return <Turn meta={`${m.model} · ${time(m.timestamp)}`}><AssistantParts m={m} results={results} running={running} /></Turn>;
    case "toolResult":
      return null; // shown in its tool card
    case "bashExecution":
      return <pre className="ml-10 rounded-md border border-line bg-code px-3 py-2.5 font-mono text-sm whitespace-pre-wrap">$ {m.command}{"\n"}{m.output}</pre>;
    case "compactionSummary":
      return <div className="text-center text-xs text-muted">compacted · {m.tokensBefore.toLocaleString()} tokens summarized</div>;
    case "branchSummary":
      return <div className="ml-10 text-xs text-muted">branch summary · {m.summary.slice(0, 160)}</div>;
    case "custom":
      if (!m.display) return null;
      // tenon-sdd sends its gate summary as this custom type: the person reads the spec, the plan, or the outcome here.
      if (m.customType === "sdd-gate") return <div className="md ml-10"><Markdown>{textOf(m.content)}</Markdown></div>;
      return <div className="ml-10 text-sm text-sub"><span className="font-mono font-semibold text-orange">{m.customType}</span> {textOf(m.content)}</div>;
    default:
      return null;
  }
}

/** "2m 10s" since the run started, updated each second. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - since) / 1000));
  return <span>{s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`}</span>;
}

export function Chat({ sessionKey, state }: { sessionKey: string; state: LiveState }) {
  const messages = useStore((s) => s.messages[sessionKey] ?? EMPTY);
  const mark = useStore((s) => (s.mark?.key === sessionKey ? s.mark.at : undefined));
  const view = useStore((s) => s.view[sessionKey] ?? "chat");
  const branches = useStore((s) => s.sessions.find((r) => r.path === state.file)?.branches ?? 1);
  const projects = useStore((s) => s.projects);
  const canvasOpen = useStore((s) => !!s.canvas[sessionKey]?.open);
  // Boards C3 and C4: "no canvas yet", or how many the project has.
  const canvasCount = useStore((s) => s.design[state.cwd]?.canvases.length || (s.canvas[sessionKey] ? 1 : 0));
  const inProject = useStore((s) => state.cwd !== s.noProject);
  const [pickerAt, setPickerAt] = useState<{ x: number; y: number }>();
  const scroller = useRef<HTMLDivElement>(null);

  // Board 2a: T opens the session tree (and goes back to the chat), when you are not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "t" || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector("[role=dialog],[role=menu]")) return;
      actions.setView(sessionKey, view === "tree" ? "chat" : "tree");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionKey, view]);

  // Board 1.2: the projects to move this session to.
  const picker: MenuItem[] = [
    { heading: "Projects" },
    ...projects
      .filter((p) => p.cwd !== state.cwd)
      .map((p): MenuItem => ({
        id: p.cwd,
        label: <span className="flex min-w-0 flex-col"><span>{p.name}</span><span className="truncate font-mono text-label opacity-75">{homePath(p.cwd)}</span></span>,
        icon: <Icon name="folder" />,
        onSelect: () => actions.move(sessionKey, p.cwd),
      })),
    "sep",
    { label: "Open a folder…", icon: <Icon name="plus" />, onSelect: () => actions.moveToFolder(sessionKey) },
    { label: "Clone from a git URL…", icon: <Icon name="download" />, disabled: true, onSelect: () => {} }, // not built yet
    "sep",
    { note: "The chat stays as it is. The session moves under the project, and pi starts working in its folder." },
  ];

  const results = new Map<string, ToolResult>();
  for (const m of messages) if (m.role === "toolResult") results.set(m.toolCallId, m);
  const running = new Set(state.runningTools);
  const count = messages.filter((m) => m.role === "user" || m.role === "assistant").length;

  // A session opens at its newest message (Chat has a key per session, so this runs once for each),
  // or at the message a search opened.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(() => {
    if (mark) scroller.current?.querySelector(`[data-at="${mark}"]`)?.scrollIntoView({ block: "center" });
  }, [mark, messages.length > 0]);

  // Follow new output, unless the user scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // A date line when the day changes. pi's messages up to the next user message are one turn under one header.
  let lastDay = "";
  const rows: ReactNode[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const day = new Date(m.timestamp).toDateString();
    if (m.role === "user" && day !== lastDay) rows.push(<div key={`d${i}`} className="text-center text-xs text-muted">{dayLabel(m.timestamp)}</div>);
    if (m.role === "user") lastDay = day;
    if (m.role !== "assistant") {
      rows.push(<Marked key={i} at={m.timestamp} mark={mark}><Message m={m} results={results} running={running} /></Marked>);
      continue;
    }
    const start = i; // the key stays the same while the turn grows, so open cards stay open
    const turn: Extract<AgentMessage, { role: "assistant" }>[] = [m];
    while (i + 1 < messages.length && (messages[i + 1].role === "assistant" || messages[i + 1].role === "toolResult")) {
      const next = messages[++i];
      if (next.role === "assistant") turn.push(next);
    }
    rows.push(
      <Turn key={start} meta={`${m.model} · ${time(m.timestamp)}`}>
        {turn.map((t, j) => (
          <Marked key={j} at={t.timestamp} mark={mark}>
            <div className="flex flex-col gap-2.5"><AssistantParts m={t} results={results} running={running} /></div>
          </Marked>
        ))}
      </Turn>,
    );
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-col bg-bg">
      <div className="flex h-[58px] shrink-0 items-center gap-2.5 border-b border-line px-[22px]">
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <b className="truncate text-lg font-[650]">{state.title}</b>
          <div className="flex items-center gap-2.5 text-xs text-muted">
            <button
              aria-haspopup="menu"
              aria-expanded={!!pickerAt}
              title={inProject ? `${state.cwd} · move to another project` : "Move this session to a project"}
              disabled={state.streaming}
              onMouseDown={(e) => e.stopPropagation()} // else the menu's click-outside closes it and this click opens it again
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setPickerAt(pickerAt ? undefined : { x: r.left, y: r.bottom + 6 });
              }}
              className={cx(
                "-ml-[5px] flex h-[22px] items-center gap-1 rounded-sm whitespace-nowrap pr-[7px] pl-[5px] font-medium disabled:opacity-50",
                inProject ? "text-sub enabled:hover:bg-hover" : "bg-accent-bg text-accent2 shadow-[inset_0_0_0_1px_var(--color-accent-line)]",
              )}
            >
              <Icon name={inProject ? "folder" : "plus"} size={13} />
              {inProject ? folderName(state.cwd) : "Add to project"}
              <Icon name="chevronDown" size={12} />
            </button>
            {state.branch && <span className="flex items-center gap-1"><Icon name="branch" size={13} />{state.branch}</span>}
            <span className="whitespace-nowrap">{count} messages</span>
            <span className="whitespace-nowrap">{canvasCount ? `${canvasCount} ${plural(canvasCount, "canvas", "canvases")}` : "no canvas yet"}</span>
          </div>
        </div>
        <Button small variant={canvasOpen ? "primary" : "default"} aria-pressed={canvasOpen} title="Design canvas (⇧C)" onClick={() => actions.canvas(sessionKey)}>
          {canvasCount ? "Canvas" : "+ Canvas"}<Kbd onFill={canvasOpen}>⇧C</Kbd>
        </Button>
        <Segmented
          label="View"
          value={view}
          onChange={(v) => actions.setView(sessionKey, v)}
          options={[{ value: "chat", label: "Chat" }, { value: "tree", label: <span title="Session tree (T)">Tree <span className="text-muted">{branches}</span></span> }]}
        />
        {pickerAt && <Menu at={pickerAt} width={380} label="Add to project" items={picker} onClose={() => setPickerAt(undefined)} />}
      </div>

      {view === "tree" && <TreeView sessionKey={sessionKey} state={state} />}
      {/* The chat stays mounted under the tree, so the message box keeps what you typed and attached. */}
      <div className={view === "tree" ? "hidden" : "contents"}>
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-auto px-[22px] pt-[22px] pb-4 [&>*]:shrink-0">
        {rows}
        {state.streaming && (
          <div className="flex items-center gap-2.5 pl-10 text-sm text-muted">
            <Spinner />
            <span className="text-sub">Working…</span>
            {state.runStartedAt && <Elapsed since={state.runStartedAt} />}
            <Kbd>Esc</Kbd>
            <span>to interrupt</span>
          </div>
        )}
      </div>
      <Composer sessionKey={sessionKey} state={state} />
      </div>
    </main>
  );
}
