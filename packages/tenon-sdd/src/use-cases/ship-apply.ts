import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { applyChange, hasRequirement, isFinalId, renderAreaSpec, staleErrors, type AreaSpec, type TestLink } from "../entities/area-spec.js";
import type { Spec } from "../entities/delta.js";
import { errorsOf, type ParseResult } from "../entities/result.js";
import type { State } from "../entities/state.js";
import { requirementLinks, type Traceability } from "../entities/traceability.js";
import { areaFrom, areasOf, areaWithPrefix, readAreas } from "./areas.js";
import { AREAS_DIR, readSpec, readTrace, type Change } from "./change.js";
import type { Deps } from "./ports.js";

export type ShipResult = { errors: string[]; ids: Map<string, string> };
type AreaUpdate = { path: string; text: string; ids: Map<string, string> };

/**
 * Ship steps 2–5: start from the area specs of the base branch, check that the delta is not stale,
 * give the final IDs, and write the area specs. If a check fails, nothing is written.
 */
export async function shipApply(deps: Deps, change: Change, state: State): Promise<ShipResult> {
  const spec = await readSpec(change);
  const trace = state.type === "docs" ? emptyTrace() : await readTrace(change);
  if (!spec.ok || !trace.ok) return { errors: [...errorsOf(spec), ...errorsOf(trace)], ids: new Map() };
  const links = requirementLinks(trace.value.rows);
  const errors: string[] = [];
  const updates: AreaUpdate[] = [];
  for (const name of await areaNames(deps.root, spec.value, links)) {
    const path = `${AREAS_DIR}/${name}.md`;
    const area = areaFrom(name, await deps.git.fileAt(state.base, path), spec.value);
    if (!area.ok) {
      errors.push(...area.errors);
      continue;
    }
    errors.push(...areaErrors(area.value, name, spec.value));
    const result = applyChange(area.value, {
      folder: change.folder,
      delta: spec.value.delta.filter((item) => item.area === name),
      baseline: spec.value.baseline.filter((item) => item.area === name),
      coverage: spec.value.coverage.find((item) => item.area === name)?.text,
      tests: links.filter((link) => belongsTo(link.id, spec.value, area.value, name)),
    });
    updates.push({ path, text: renderAreaSpec(result.area), ids: result.ids });
  }
  if (errors.length) return { errors, ids: new Map() };
  for (const update of updates) {
    await mkdir(dirname(join(deps.root, update.path)), { recursive: true });
    await writeFile(join(deps.root, update.path), update.text);
  }
  return { errors: [], ids: new Map(updates.flatMap((update) => [...update.ids])) };
}

/** The areas of the delta and the baseline, and the areas whose prefix a test link names. */
async function areaNames(root: string, spec: Spec, links: readonly TestLink[]): Promise<string[]> {
  const areas = await readAreas(root);
  const linked = links.filter((link) => isFinalId(link.id)).map((link) => areaWithPrefix(areas, link.id));
  return [...new Set([...areasOf(spec), ...linked.filter((name): name is string => name !== undefined)])];
}

function areaErrors(area: AreaSpec, name: string, spec: Spec): string[] {
  const stale = staleErrors(area, spec.delta.filter((item) => item.area === name));
  const { requirement } = spec;
  const isLost = requirement !== undefined && requirement.startsWith(`${area.prefix}-`) && !hasRequirement(area, requirement);
  return isLost ? [...stale, `${requirement} is not in the area spec any more.`] : stale;
}

/** A link with a final ID belongs to the area of its prefix. A NEW or BASE ID belongs to the area of its delta or baseline item. */
function belongsTo(id: string, spec: Spec, area: AreaSpec, name: string): boolean {
  if (isFinalId(id)) return id.startsWith(`${area.prefix}-`);
  return [...spec.delta, ...spec.baseline].some((item) => item.id === id && item.area === name);
}

function emptyTrace(): ParseResult<Traceability> {
  return { ok: true, value: { head: [], rows: [], footer: [] } };
}
