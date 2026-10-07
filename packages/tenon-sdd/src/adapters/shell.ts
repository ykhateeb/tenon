import { spawn } from "node:child_process";

export type CommandResult = { code: number | null; output: string; timedOut: boolean };

const MAX_OUTPUT = 20_000;

/** Run a shell command in a folder. Keep the last part of stdout and stderr. Stop it after the timeout. */
export function runCommand(command: string, { cwd, timeoutMs }: { cwd: string; timeoutMs: number }): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, detached: true });
    let output = "";
    let timedOut = false;
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-MAX_OUTPUT);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      timedOut = true;
      stopGroup(child.pid);
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

/** ponytail: stops the POSIX process group. On Windows, only the shell stops. */
function stopGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group already ended.
  }
}
