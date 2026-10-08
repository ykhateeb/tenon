import { spawn, type ChildProcessByStdio } from "node:child_process";
import { type Readable } from "node:stream";

export type CommandResult = { code: number | null; output: string; timedOut: boolean };

const MAX_OUTPUT = 20_000;

/** Run a shell command in a folder. Keep the last part of stdout and stderr. Stop it after the timeout. */
export function runCommand(command: string, { cwd, timeoutMs }: { cwd: string; timeoutMs: number }): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    // The decoder keeps a character that a chunk boundary splits.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const keep = (chunk: string) => {
      output = (output + chunk).slice(-MAX_OUTPUT);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      timedOut = true;
      stopGroup(child);
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}${error.message}\n`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
  });
}

/** Stop the process and its children. On Windows, falls back to killing only the shell. */
function stopGroup(child: ChildProcessByStdio<null, Readable, Readable>): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // Fall back on Windows or if the group already ended.
    try {
      child.kill("SIGKILL");
    } catch {
      // The process already ended.
    }
  }
}
