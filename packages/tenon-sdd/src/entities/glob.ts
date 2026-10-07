/**
 * A glob as a RegExp for paths relative to the project root, with "/" separators.
 * ponytail: supports `**`, `*`, and `?` only. Add braces or character classes if a project's globs need them.
 */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      const isFolderPart = glob[i + 2] === "/";
      source += isFolderPart ? "(?:.*/)?" : ".*";
      i += isFolderPart ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

/** The folder before the first wildcard: where a search for the glob starts. */
export function globBase(glob: string): string {
  const parts = glob.split("/");
  return parts.slice(0, parts.findIndex((part) => /[*?]/.test(part))).join("/");
}
