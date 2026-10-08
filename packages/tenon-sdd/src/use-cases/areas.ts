import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { newArea, parseAreaSpec, type AreaSpec } from "../entities/area-spec.js";
import type { Spec } from "../entities/delta.js";
import type { ParseResult } from "../entities/result.js";
import { AREAS_DIR, readText } from "./change.js";

/** The areas that the delta and the baseline of a spec name. */
export function areasOf(spec: Spec): string[] {
  return [...new Set([...spec.delta.map((item) => item.area), ...spec.baseline.map((item) => item.area)])];
}

/** The area spec from its text, or a new area that the spec marks with a prefix. */
export function areaFrom(name: string, text: string | undefined, spec: Spec): ParseResult<AreaSpec> {
  if (text !== undefined) return parseAreaSpec(text);
  const created = spec.newAreas.find((area) => area.area === name);
  if (created) return { ok: true, value: newArea(name, created.prefix) };
  return { ok: false, errors: [`${AREAS_DIR}/${name}.md does not exist. For a new area, write the heading "### ${AREAS_DIR}/${name}.md (new, prefix <ABC>)".`] };
}

/** The valid area specs in the working tree, by name. */
export async function readAreas(root: string): Promise<Map<string, AreaSpec>> {
  const files = await readdir(join(root, AREAS_DIR)).catch(() => []);
  const areas = new Map<string, AreaSpec>();
  for (const file of files.filter((name) => name.endsWith(".md"))) {
    const result = parseAreaSpec((await readText(root, `${AREAS_DIR}/${file}`)) ?? "");
    if (result.ok) areas.set(file.slice(0, -3), result.value);
  }
  return areas;
}

/** The name of the area whose prefix starts the ID, for example favorites for FAV-R-002. */
export function areaWithPrefix(areas: ReadonlyMap<string, AreaSpec>, id: string): string | undefined {
  const prefix = id.split("-")[0];
  return [...areas].find(([, area]) => area.prefix === prefix)?.[0];
}
