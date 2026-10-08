import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGit } from "./git.js";

function repository() {
  const root = mkdtempSync(join(tmpdir(), "tenon-sdd-"));
  const run = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  run("init", "-q", "-b", "main");
  run("config", "user.name", "Sam");
  run("config", "user.email", "sam@example.com");
  run("config", "commit.gpgsign", "false");
  writeFileSync(join(root, "a.txt"), "one\n");
  run("add", "-A");
  run("commit", "-q", "-m", "base");
  return { root, run, git: createGit(root) };
}

describe("createGit", () => {
  it("reads the branch, the user, and the clean state", async () => {
    const { root, git } = repository();
    expect(await git.isRepository()).toBe(true);
    expect(await git.currentBranch()).toBe("main");
    expect(await git.userName()).toBe("Sam");
    expect(await git.isClean()).toBe(true);
    writeFileSync(join(root, "b.txt"), "new\n");
    expect(await git.isClean()).toBe(false);
  });

  it("makes a branch and finds it by a pattern", async () => {
    const { git } = repository();
    await git.createBranch("sdd/2026-10-08-sort");
    expect(await git.currentBranch()).toBe("sdd/2026-10-08-sort");
    expect(await git.branchExists("sdd/*-sort")).toBe(true);
    expect(await git.branchExists("sdd/*-other")).toBe(false);
  });

  it("commits all work, and returns undefined when there is nothing to commit", async () => {
    const { root, git } = repository();
    writeFileSync(join(root, "a.txt"), "two\n");
    const commit = await git.commitAll("change a");
    expect(commit).toBe(await git.head());
    expect(await git.commitAll("nothing")).toBeUndefined();
    expect(await git.isCommitted("a.txt")).toBe(true);
    expect(await git.fileAt("HEAD~1", "a.txt")).toBe("one");
    expect(await git.fileAt("HEAD", "missing.txt")).toBeUndefined();
  });

  it("finds changed and new files in paths, and restores them", async () => {
    const { root, git } = repository();
    writeFileSync(join(root, "a.txt"), "changed\n");
    writeFileSync(join(root, "c.txt"), "new\n");
    expect((await git.changedSince("HEAD", ["a.txt", "c.txt"])).sort()).toEqual(["a.txt", "c.txt"]);
    expect(await git.changedSince("HEAD", [])).toEqual([]);
    await git.restore("HEAD", ["a.txt", "c.txt"]);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("one\n");
    expect(existsSync(join(root, "c.txt"))).toBe(false);
  });

  it("merges the base, and leaves a conflict for the person", async () => {
    const { root, run, git } = repository();
    await git.createBranch("sdd/2026-10-08-sort");
    writeFileSync(join(root, "a.txt"), "branch\n");
    await git.commitAll("branch edit");
    const fork = await git.forkPoint("main");
    run("switch", "-q", "main");
    writeFileSync(join(root, "a.txt"), "main\n");
    run("commit", "-qam", "main edit");
    run("switch", "-q", "sdd/2026-10-08-sort");
    expect(await git.changedBetween(fork, "HEAD")).toEqual(["a.txt"]);
    const merge = await git.mergeBase("main");
    expect(merge.ok).toBe(false);
    if (!merge.ok) expect(merge.output).toContain("CONFLICT");
    expect(await git.isClean()).toBe(false);
    expect(await git.isMerging()).toBe(true);
  });

  it("throws on commitAll with unresolved conflicts", async () => {
    const { root, run, git } = repository();
    await git.createBranch("sdd/2026-10-08-sort");
    writeFileSync(join(root, "a.txt"), "branch\n");
    await git.commitAll("branch edit");
    run("switch", "-q", "main");
    writeFileSync(join(root, "a.txt"), "main\n");
    run("commit", "-qam", "main edit");
    run("switch", "-q", "sdd/2026-10-08-sort");
    await git.mergeBase("main");
    await expect(git.commitAll("merge")).rejects.toThrow("Resolve the merge conflicts first");
  });

  it("commits after resolving merge conflicts", async () => {
    const { root, run, git } = repository();
    await git.createBranch("sdd/2026-10-08-sort");
    writeFileSync(join(root, "a.txt"), "branch\n");
    await git.commitAll("branch edit");
    run("switch", "-q", "main");
    writeFileSync(join(root, "a.txt"), "main\n");
    run("commit", "-qam", "main edit");
    run("switch", "-q", "sdd/2026-10-08-sort");
    await git.mergeBase("main");
    run("checkout", "--ours", "a.txt");
    run("add", "a.txt");
    const commit = await git.commitAll("resolved");
    expect(commit).toBeDefined();
    expect(await git.isMerging()).toBe(false);
  });

  it("preserves non-ASCII filenames", async () => {
    const { root, git } = repository();
    const filename = "é.txt";
    writeFileSync(join(root, filename), "content\n");
    const changed = await git.changedSince("HEAD", [filename]);
    expect(changed).toContain(filename);
  });

  it("lists both old and new names on rename", async () => {
    const { root, run, git } = repository();
    run("mv", "a.txt", "b.txt");
    run("add", "-A");
    const changed = await git.changedSince("HEAD", ["a.txt", "b.txt"]);
    expect(changed.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("rejects restore with path traversal", async () => {
    const { git } = repository();
    await expect(git.restore("HEAD", ["../outside.txt"])).rejects.toThrow("Path is outside the repository");
  });

  it("resets to a commit with changes in the staging area", async () => {
    const { root, git } = repository();
    const base = await git.head();
    writeFileSync(join(root, "a.txt"), "changed\n");
    await git.commitAll("edit");
    const edit = await git.head();
    expect(edit).not.toBe(base);
    await git.resetSoft(base);
    expect(await git.head()).toBe(base);
    const changed = await git.changedSince("HEAD", ["a.txt"]);
    expect(changed).toContain("a.txt");
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("changed\n");
  });
});
