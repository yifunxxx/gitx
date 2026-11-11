import type { ActionDef } from "./types";
import { listActions } from "./registry";

export type Platform = "mac" | "win" | "linux";
export type KeymapOverrides = Partial<Record<string, string[]>>;
let overridesProvider: (() => KeymapOverrides | undefined) | null = null;

export function setKeymapOverridesProvider(provider: () => KeymapOverrides | undefined) {
  overridesProvider = provider;
  return () => {
    if (overridesProvider === provider) overridesProvider = null;
  };
}

export function detectPlatform(): Platform {
  const ua = navigator.platform.toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "win";
  return "linux";
}

/** An explicit draft (even {}) never falls back to persisted overrides. [] disables. */
export function shortcutFor(
  def: ActionDef,
  platform = detectPlatform(),
  overrides: KeymapOverrides = overridesProvider?.() ?? {},
): string[] {
  if (Array.isArray(overrides[def.id])) return overrides[def.id]!;
  const map = def.defaultShortcuts;
  if (!map) return [];
  if (platform === "mac") return map.mac ?? map.win ?? map.linux ?? [];
  if (platform === "win") return map.win ?? map.linux ?? map.mac ?? [];
  return map.linux ?? map.win ?? map.mac ?? [];
}

const keyAliases: Record<string, string> = {
  " ": "space",
  "+": "plus",
  esc: "escape",
  return: "enter",
  del: "delete",
};
function keyName(key: string): string {
  const lower = key.toLowerCase();
  return keyAliases[lower] ?? lower;
}

/** Canonical modifiers keep physical Ctrl/Meta distinct; Mod follows the platform. */
export function normalizeShortcut(chord: string, platform = detectPlatform()): string | null {
  let raw = chord.trim().toLowerCase();
  if (raw === "+") raw = "plus";
  else if (raw.endsWith("++")) raw = raw.slice(0, -1) + "plus";
  const parts = raw.split("+").map((part) => part.trim());
  const key = keyName(parts.pop() ?? "");
  if (
    !key ||
    /\s/.test(key) ||
    [
      "mod",
      "shift",
      "control",
      "ctrl",
      "meta",
      "alt",
      "altgraph",
      "dead",
      "process",
      "unidentified",
    ].includes(key)
  )
    return null;
  const modifiers = new Set<string>();
  for (const part of parts) {
    const name =
      part === "mod" ? (platform === "mac" ? "meta" : "ctrl") : part === "control" ? "ctrl" : part;
    if (!["ctrl", "meta", "alt", "shift"].includes(name)) return null;
    modifiers.add(name);
  }
  return [...["ctrl", "meta", "alt", "shift"].filter((part) => modifiers.has(part)), key].join("+");
}

export function isShortcutEvent(event: KeyboardEvent): boolean {
  return (
    !event.defaultPrevented &&
    !event.repeat &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !event.getModifierState?.("AltGraph") &&
    (!!event.key || event.code === "Backquote") &&
    !["Dead", "Process", "Unidentified"].includes(event.key)
  );
}

/** Use the same key identity for recording and execution, including native empty code. */
function eventChord(event: KeyboardEvent): string | null {
  if (!isShortcutEvent(event)) return null;
  if (["Shift", "Control", "Alt", "Meta", "AltGraph"].includes(event.key)) return null;
  const key = /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3).toLowerCase()
    : event.code === "Backquote"
      ? "`"
      : keyName(event.key);
  return [
    ...(event.ctrlKey ? ["ctrl"] : []),
    ...(event.metaKey ? ["meta"] : []),
    ...(event.altKey ? ["alt"] : []),
    ...(event.shiftKey ? ["shift"] : []),
    key,
  ].join("+");
}

export function chordFromEvent(event: KeyboardEvent, platform = detectPlatform()): string | null {
  const chord = eventChord(event);
  if (!chord) return null;
  const parts = chord.split("+");
  return parts
    .map((part, index) =>
      index < parts.length - 1 && part === (platform === "mac" ? "meta" : "ctrl") ? "mod" : part,
    )
    .join("+");
}

export function matchShortcut(
  event: KeyboardEvent,
  chord: string,
  platform = detectPlatform(),
): boolean {
  const actual = eventChord(event);
  if (actual == null) return false;
  const expected = normalizeShortcut(chord, platform);
  if (actual === expected) return true;
  // Preserve existing logical-key bindings while new recordings use stable letter codes.
  const logical = actual.split("+");
  logical[logical.length - 1] = keyName(event.key);
  return logical.join("+") === expected;
}

export function findActionIdByEvent(event: KeyboardEvent): string | undefined {
  if (!isShortcutEvent(event)) return undefined;
  const matches = listActions().filter((action) =>
    shortcutFor(action).some((chord) => matchShortcut(event, chord)),
  );
  // Imported/legacy duplicate bindings must not silently execute an unrelated action.
  return matches.length === 1 ? matches[0]!.id : undefined;
}

export function findShortcutConflicts(
  actionId: string,
  chord: string,
  overrides: KeymapOverrides = overridesProvider?.() ?? {},
  platform = detectPlatform(),
): string[] {
  const target = normalizeShortcut(chord, platform);
  if (!target) return [];
  return listActions()
    .filter(
      (action) =>
        action.id !== actionId &&
        shortcutFor(action, platform, overrides).some(
          (value) => normalizeShortcut(value, platform) === target,
        ),
    )
    .map((action) => action.id);
}

/** These application/OS shortcuts are handled before action dispatch. */
export function reservedShortcut(chord: string, platform = detectPlatform()): string | null {
  const value = normalizeShortcut(chord, platform);
  if (!value) return "settings.keymap.invalid";
  if (["ctrl+shift+a", "meta+shift+a"].includes(value)) return "actions.findAction";
  if (["ctrl+`", "meta+`"].includes(value)) return "toolWindows.terminal";
  if (
    value === "alt+f4" ||
    value === "ctrl+alt+delete" ||
    (platform === "win" && value.split("+").includes("meta")) ||
    (platform === "mac" && ["meta+q", "meta+h", "meta+m", "meta+alt+h"].includes(value))
  )
    return "settings.keymap.systemShortcut";
  return null;
}

export function formatShortcut(chord: string, platform = detectPlatform()): string {
  const value = normalizeShortcut(chord, platform);
  if (!value) return chord;
  return value
    .split("+")
    .map(
      (part) =>
        ({
          ctrl: "Ctrl",
          meta: platform === "mac" ? "⌘" : "Meta",
          alt: "Alt",
          shift: "Shift",
          space: "Space",
          plus: "+",
          arrowup: "↑",
          arrowdown: "↓",
          arrowleft: "←",
          arrowright: "→",
        })[part] ??
        (part.length === 1 || /^f\d+$/.test(part)
          ? part.toUpperCase()
          : part[0]!.toUpperCase() + part.slice(1)),
    )
    .join("+");
}
