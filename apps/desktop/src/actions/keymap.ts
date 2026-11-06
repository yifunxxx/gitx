import type { ActionDef } from "./types";
import { listActions } from "./registry";

export type Platform = "mac" | "win" | "linux";

let overridesProvider: (() => Record<string, string[]> | undefined) | null = null;

/** Wire settings keymap overrides (called from settings bootstrap / store). */
export function setKeymapOverridesProvider(
  provider: () => Record<string, string[]> | undefined,
) {
  overridesProvider = provider;
}

export function detectPlatform(): Platform {
  const ua = navigator.platform.toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "win";
  return "linux";
}

export function shortcutFor(def: ActionDef, platform = detectPlatform()): string[] {
  const overrides = overridesProvider?.()?.[def.id];
  if (overrides?.length) return overrides;

  const map = def.defaultShortcuts;
  if (!map) return [];
  if (platform === "mac") return map.mac ?? map.win ?? map.linux ?? [];
  if (platform === "win") return map.win ?? map.linux ?? map.mac ?? [];
  return map.linux ?? map.win ?? map.mac ?? [];
}

export function matchShortcut(event: KeyboardEvent, chord: string): boolean {
  const parts = chord.toLowerCase().split("+");
  const key = parts[parts.length - 1]!;
  const needMod = parts.includes("mod") || parts.includes("ctrl") || parts.includes("meta");
  const needShift = parts.includes("shift");
  const needAlt = parts.includes("alt");
  const isMac = detectPlatform() === "mac";
  const modPressed = isMac ? event.metaKey : event.ctrlKey;

  if (needMod !== modPressed) return false;
  if (needShift !== event.shiftKey) return false;
  if (needAlt !== event.altKey) return false;
  if (key === "space") return event.code === "Space" || event.key === " ";
  if (key === ",") return event.key === ",";
  return event.key.toLowerCase() === key || event.code.toLowerCase() === `key${key}`;
}

export function findActionIdByEvent(event: KeyboardEvent): string | undefined {
  for (const action of listActions()) {
    for (const chord of shortcutFor(action)) {
      if (matchShortcut(event, chord)) return action.id;
    }
  }
  return undefined;
}

/** Detect conflicts for a proposed chord against current bindings. */
export function findShortcutConflicts(
  actionId: string,
  chord: string,
): string[] {
  const conflicts: string[] = [];
  const target = chord.toLowerCase();
  for (const action of listActions()) {
    if (action.id === actionId) continue;
    for (const c of shortcutFor(action)) {
      if (c.toLowerCase() === target) conflicts.push(action.id);
    }
  }
  return conflicts;
}
