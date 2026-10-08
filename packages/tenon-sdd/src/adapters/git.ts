import { execFile } from "node:child_process";
import { relative, resolve } from "node:path";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export type MergeResult = { ok: true } | { ok: false; output: string };
export type Git = ReturnType<typeof createGit>;

/** git commands in one repository. Each failure names the command. */
export function createGit(root: string) {
  async function git(...args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["-c", "core.quotePath=false", ...args], { cwd: root, maxBuffer: MAX_BUFFER });
      return stdout.trim();
    } catch (error) {
      throw new Error(`git ${args.join(" ")} failed: ${outputOf(error)}`, { cause: error });
    }
  }
  const succeeds = (...args: string[]) => git(...args).then(() => true, () => false);
  const lines = (text: string) => text.split("\n").filter(Boolean);
  const checkMerging = () => succeeds("rev-parse", "-q", "--verify", "MERGE_HEAD");

  return {
    isRepository: () => succeeds("rev-parse", "--is-inside-work-tree"),
    root: () => git("rev-parse", "--show-toplevel"),
    currentBranch: () => git("branch", "--show-current"),
    head: () => git("rev-parse", "HEAD"),
    userName: async () => (await git("config", "user.name").catch(() => "")) || "unknown",
    isClean: async () => (await git("status", "--porcelain")) === "",
    /** True if a local or a remote branch matches the pattern, for example sdd/*-sort. */
    branchExists: async (pattern: string) => (await git("for-each-ref", "--format=%(refname)", `refs/heads/${pattern}`, `refs/remotes/*/${pattern}`)) !== "",
    createBranch: async (name: string) => {
      await git("switch", "-q", "-c", name);
    },
    /** Commit all work. Returns the new commit, or undefined if there was nothing to commit. */
    commitAll: async (message: string) => {
      const unmerged = lines(await git("diff", "--name-only", "--diff-filter=U"));
      if (unmerged.length) throw new Error(`Resolve the merge conflicts first: ${unmerged.join(", ")}`);
      await git("add", "-A");
      const hasDiff = !(await succeeds("diff", "--cached", "--quiet"));
      if (!hasDiff && !(await checkMerging())) return undefined;
      await git("commit", "-q", "-m", message);
      return git("rev-parse", "HEAD");
    },
    /** True while a merge waits for the person to resolve its conflicts. */
    isMerging: () => checkMerging(),
    /** Merge the base into the current branch. A conflict stays in the tree for the person to resolve. */
    mergeBase: async (base: string): Promise<MergeResult> => {
      try {
        await execFileAsync("git", ["-c", "core.quotePath=false", "merge", "-q", "--no-edit", base], { cwd: root, maxBuffer: MAX_BUFFER });
        return { ok: true };
      } catch (error) {
        return { ok: false, output: outputOf(error) };
      }
    },
    forkPoint: (base: string, ref = "HEAD") => git("merge-base", ref, base),
    changedBetween: async (from: string, to: string) => lines(await git("diff", "--name-only", "--no-renames", from, to)),
    /** Tracked files that differ from the commit, and untracked files, in these paths. */
    changedSince: async (commit: string, paths: readonly string[]) => {
      if (!paths.length) return [];
      const tracked = lines(await git("diff", "--name-only", "--no-renames", commit, "--", ...paths));
      const untracked = lines(await git("ls-files", "--others", "--exclude-standard", "--", ...paths));
      return [...new Set([...tracked, ...untracked])];
    },
    /** Put the files back as they are in the commit. A file that the commit does not have is deleted. */
    restore: async (commit: string, paths: readonly string[]) => {
      for (const path of paths) {
        const resolved = resolve(root, path);
        const rel = relative(root, resolved);
        if (rel.startsWith("..") || resolve(rel) === rel) throw new Error(`Path is outside the repository: ${path}`);
        if (await succeeds("cat-file", "-e", `${commit}:${path}`)) await git("checkout", commit, "--", path);
        else await rm(resolved, { force: true });
      }
    },
    isCommitted: (path: string) => succeeds("cat-file", "-e", `HEAD:${path}`),
    fileAt: (ref: string, path: string) => git("show", `${ref}:${path}`).catch(() => undefined),
    diff: (from: string, paths: readonly string[] = []) => git("diff", from, "HEAD", "--", ...paths),
    diffStat: (from: string) => git("diff", "--stat", from, "HEAD"),
    resetSoft: async (commit: string) => {
      await git("reset", "-q", "--soft", commit);
    },
  };
}

function outputOf(error: unknown): string {
  const { stderr, stdout, message } = error as { stderr?: string; stdout?: string; message?: string };
  const parts = [];
  if (stderr?.trim()) parts.push(stderr.trim());
  if (stdout?.trim()) parts.push(stdout.trim());
  return parts.length ? parts.join("\n") : (message || String(error)).trim();
}
