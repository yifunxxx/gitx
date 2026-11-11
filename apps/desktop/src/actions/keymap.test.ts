import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  chordFromEvent,
  findActionIdByEvent,
  findShortcutConflicts,
  formatShortcut,
  matchShortcut,
  normalizeShortcut,
  reservedShortcut,
  setKeymapOverridesProvider,
  shortcutFor,
} from "./keymap";
import type { ActionDef } from "./types";
const state = vi.hoisted(() => ({ actions: [] as ActionDef[] }));
vi.mock("./registry", () => ({ listActions: () => state.actions }));
const action = (id: string, chord: string): ActionDef => ({
  id,
  title: id,
  defaultShortcuts: { win: [chord] },
  run: async () => {},
});
beforeEach(() => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  // happy-dom reports any Alt as AltGraph; model independent modifiers here.
  const modifierState = KeyboardEvent.prototype.getModifierState;
  vi.spyOn(KeyboardEvent.prototype, "getModifierState").mockImplementation(function (this: KeyboardEvent, key) {
    return key === "AltGraph" ? false : modifierState.call(this, key);
  });
  state.actions = [action("first", "ctrl+k"), action("second", "ctrl+p")];
  setKeymapOverridesProvider(() => ({}));
});
afterEach(() => vi.restoreAllMocks());

it("treats an explicit empty binding as disabled", () => {
  setKeymapOverridesProvider(() => ({ first: [] }));
  expect(shortcutFor(state.actions[0]!)).toEqual([]);
  expect(
    findActionIdByEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })),
  ).toBeUndefined();
});
it("compares equivalent mod and ctrl bindings for conflicts", () => {
  expect(findShortcutConflicts("second", "mod+k")).toEqual(["first"]);
});
it("does not arbitrarily execute an ambiguous binding", () => {
  setKeymapOverridesProvider(() => ({ second: ["mod+k"] }));
  expect(
    findActionIdByEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })),
  ).toBeUndefined();
});
it("matches Ctrl and Meta independently and rejects extra modifiers", () => {
  expect(matchShortcut(new KeyboardEvent("keydown", { key: "k", metaKey: true }), "meta+k")).toBe(
    true,
  );
  expect(
    matchShortcut(
      new KeyboardEvent("keydown", { key: "k", ctrlKey: true, metaKey: true }),
      "ctrl+k",
    ),
  ).toBe(false);
});
it.each([{ repeat: true }, { isComposing: true }, { keyCode: 229 }])(
  "ignores unsafe key event %j",
  (flags) => {
    expect(
      findActionIdByEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, ...flags })),
    ).toBeUndefined();
  },
);

it("resolves explicit drafts and defaults independently of saved overrides", () => {
  setKeymapOverridesProvider(() => ({ first: ["mod+9"] }));
  expect(shortcutFor(state.actions[0]!, "win", {})).toEqual(["ctrl+k"]);
  expect(shortcutFor(state.actions[0]!, "win", { first: [] })).toEqual([]);
  expect(findShortcutConflicts("second", "mod+k", {}, "win")).toEqual(["first"]);
  expect(findShortcutConflicts("second", "mod+k", { first: [] }, "win")).toEqual([]);
});

it.each([
  ["win", { key: "K", code: "KeyK", ctrlKey: true, shiftKey: true }, "mod+shift+k"],
  ["mac", { key: "k", metaKey: true }, "mod+k"],
  ["mac", { key: "k", ctrlKey: true }, "ctrl+k"],
  ["win", { key: "+", code: "Equal", ctrlKey: true, shiftKey: true }, "mod+shift+plus"],
  ["win", { key: " ", ctrlKey: true }, "mod+space"],
  ["win", { key: "ф", code: "KeyA", ctrlKey: true }, "mod+a"],
  ["win", { key: "F8", ctrlKey: true, altKey: true }, "mod+alt+f8"],
] as const)("round-trips a recorded shortcut on %s: %j", (platform, init, expected) => {
  const event = new KeyboardEvent("keydown", init);
  expect(chordFromEvent(event, platform)).toBe(expected);
  expect(matchShortcut(event, expected, platform)).toBe(true);
});

it("normalizes modifier order, aliases and legacy literal plus", () => {
  expect(normalizeShortcut(" SHIFT + Mod + K ", "win")).toBe("ctrl+shift+k");
  expect(normalizeShortcut("mod+shift++", "win")).toBe("ctrl+shift+plus");
  expect(formatShortcut("mod+shift+plus", "win")).toBe("Ctrl+Shift++");
  expect(normalizeShortcut("mod+k mod+c")).toBeNull();
  expect(normalizeShortcut("mod+")).toBeNull();
});

it("keeps physical Ctrl and platform Mod distinct on Mac", () => {
  expect(
    matchShortcut(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }), "mod+k", "mac"),
  ).toBe(false);
  expect(
    matchShortcut(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }), "ctrl+k", "mac"),
  ).toBe(true);
});

it("preserves legacy logical letters on a different keyboard layout", () => {
  const event = new KeyboardEvent("keydown", { key: "ф", code: "KeyA", ctrlKey: true });
  expect(matchShortcut(event, "mod+ф")).toBe(true);
  expect(matchShortcut(event, "mod+a")).toBe(true);
});

it("ignores consumed, dead and AltGraph input", () => {
  const consumed = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
  consumed.preventDefault();
  expect(findActionIdByEvent(consumed)).toBeUndefined();
  for (const key of ["Dead", "Process", "Unidentified", ""])
    expect(chordFromEvent(new KeyboardEvent("keydown", { key }))).toBeNull();
  const altgr = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, altKey: true });
  vi.spyOn(altgr, "getModifierState").mockImplementation((key) => key === "AltGraph");
  expect(chordFromEvent(altgr)).toBeNull();
});

it("reserves the fixed app and system keys but permits regular user shortcuts", () => {
  expect(reservedShortcut("mod+shift+a", "win")).toBe("actions.findAction");
  expect(reservedShortcut("mod+`", "win")).toBe("toolWindows.terminal");
  expect(reservedShortcut("alt+f4", "win")).toBe("settings.keymap.systemShortcut");
  expect(reservedShortcut("mod+q", "mac")).toBe("settings.keymap.systemShortcut");
  expect(reservedShortcut("mod+alt+9", "win")).toBeNull();
});

it("releases the settings provider without clearing a newer registration", () => {
  const releaseOld = setKeymapOverridesProvider(() => ({ first: [] }));
  const releaseNew = setKeymapOverridesProvider(() => ({ first: ["mod+9"] }));
  releaseOld();
  expect(shortcutFor(state.actions[0]!)).toEqual(["mod+9"]);
  releaseNew();
  expect(shortcutFor(state.actions[0]!)).toEqual(["ctrl+k"]);
});
