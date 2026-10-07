import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCommand } from "./shell.js";

describe("runCommand", () => {
  it("returns the exit code and the output", async () => {
    expect(await runCommand("echo hello && exit 3", { cwd: tmpdir(), timeoutMs: 5000 })).toEqual({ code: 3, output: "hello\n", timedOut: false });
  });

  it("stops a command that runs too long", async () => {
    const result = await runCommand("sleep 5", { cwd: tmpdir(), timeoutMs: 200 });
    expect(result.timedOut).toBe(true);
  });
});
