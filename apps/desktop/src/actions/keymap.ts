import type { ActionDef } from "./types";
import { listActions } from "./registry";

export type Platform = "mac" | "win" | "linux";

export function detectPlatform(): Platform {
  const ua = navigator.platform.toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "win";
  return "linux";
}

export function shortcutFor(def: ActionDef, platform = detectPlatform()): string[] {
  const map = def.defaultShortcuts;
  if (!map) return [];
  if (platform === "mac") return map.mac ?? map.win ?? map.linux ?? [];
  if (platform === "win") return map.win ?? map.linux ?? map.mac ?? [];
  return map.linux ?? map.win ?? map.mac ?? [];
}

export function matchShortcut(event: KeyboardEvent, chord: string): boolean {
  const parts = chord.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const needMod = parts.includes("mod") || parts.includes("ctrl") || parts.includes("meta");
  const needShift = parts.includes("shift");
  const needAlt = parts.includes("alt");
  const isMac = detectPlatform() === "mac";
  const modPressed = isMac ? event.metaKey : event.ctrlKey;

  if (needMod !== modPressed) return false;
  if (needShift !== event.shiftKey) return false;
  if (needAlt !== event.altKey) return false;
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
