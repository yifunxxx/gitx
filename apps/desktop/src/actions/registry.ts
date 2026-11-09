import type { ActionContext, ActionDef, ActionGroup, EnabledResult } from "./types";

const actions = new Map<string, ActionDef>();
const groups = new Map<string, ActionGroup>();

export function registerAction(def: ActionDef) {
  actions.set(def.id, def);
}

export function registerGroup(group: ActionGroup) {
  groups.set(group.id, group);
}

export function getAction(id: string): ActionDef | undefined {
  return actions.get(id);
}

export function listActions(): ActionDef[] {
  return [...actions.values()];
}

export function getGroup(id: string): ActionGroup | undefined {
  return groups.get(id);
}

export function isVisible(def: ActionDef, ctx: ActionContext): boolean {
  return def.when ? def.when(ctx) : true;
}

export function isEnabled(def: ActionDef, ctx: ActionContext): EnabledResult {
  if (!def.enabled) return true;
  return def.enabled(ctx);
}

export async function runAction(id: string, ctx: ActionContext): Promise<void> {
  const def = actions.get(id);
  if (!def) throw new Error(`Unknown action: ${id}`);
  // Guard missing ctx (e.g. template `@click="runAction('X')"` without args) —
  // otherwise `enabled` throws and the click looks like a silent no-op.
  const safeCtx: ActionContext = ctx ?? {
    repoIds: [],
    selection: {},
    source: "popup",
    place: "unknown",
    folderPath: null,
  };
  if (!isVisible(def, safeCtx)) return;
  const en = isEnabled(def, safeCtx);
  if (en !== true) return;
  await def.run(safeCtx);
}

export function searchActions(
  query: string,
  ctx: ActionContext,
  displayedTitle?: (action: ActionDef) => string,
): ActionDef[] {
  const q = query.trim().toLowerCase();
  return listActions().filter((a) => {
    if (!isVisible(a, ctx)) return false;
    if (!q) return true;
    return (
      a.id.toLowerCase().includes(q) ||
      a.title.toLowerCase().includes(q) ||
      (displayedTitle?.(a).toLowerCase().includes(q) ?? false) ||
      (a.description?.toLowerCase().includes(q) ?? false)
    );
  });
}
