/** Replace the section `## <heading>` up to the next `## ` heading, or add it at the end. */
export function upsertSection(markdown: string, heading: string, body: string): string {
  const lines = markdown.replace(/\s+$/, "").split(/\r?\n/);
  const section = [`## ${heading}`, ...body.split("\n")];
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return [...lines, "", ...section, ""].join("\n");
  const next = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  const rest = next < 0 ? [] : ["", ...lines.slice(next)];
  return [...lines.slice(0, start), ...section, ...rest, ""].join("\n");
}

export function hasSection(markdown: string, heading: string): boolean {
  return markdown.split(/\r?\n/).some((line) => line.trim() === `## ${heading}`);
}
