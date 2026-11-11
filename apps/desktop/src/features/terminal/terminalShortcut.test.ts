import { expect, it } from "vitest";
import { isTerminalToggle } from "./terminalShortcut";

it.each<KeyboardEventInit>([
  { code: "Backquote", key: "`", ctrlKey: true },
  { code: "Backquote", key: "§", ctrlKey: true },
  { code: "Backquote", metaKey: true },
  { key: "`", ctrlKey: true },
  { key: "`", metaKey: true },
])("recognizes the terminal toggle: %j", (init) => {
  expect(isTerminalToggle(new KeyboardEvent("keydown", init))).toBe(true);
});

it.each<KeyboardEventInit>([
  { code: "KeyA", key: "`", ctrlKey: true },
  { key: "~", ctrlKey: true },
  { key: "Dead", ctrlKey: true },
  { ctrlKey: true },
  { code: "Backquote" },
  { key: "`" },
  ...["Backquote", ""].flatMap((code) =>
    ["isComposing", "repeat", "shiftKey", "altKey"].map((flag) => ({
      code,
      key: "`",
      ctrlKey: true,
      [flag]: true,
    })),
  ),
])("leaves other input alone: %j", (init) => {
  expect(isTerminalToggle(new KeyboardEvent("keydown", init))).toBe(false);
});
