import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { focusCommitUi } from "./focusCommitUi";

const layout = vi.hoisted(() => ({
  commitTwMode: "docked" as "docked" | "window" | "float",
  leftOpen: false,
  commitControlsHidden: true,
}));

vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => layout }));

beforeEach(() => {
  layout.commitTwMode = "docked";
  layout.leftOpen = false;
  layout.commitControlsHidden = true;
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

it("opens the docked Commit TW, shows controls, and focuses the message", async () => {
  const area = document.createElement("textarea");
  area.setAttribute("data-gitx-commit-message", "");
  document.body.appendChild(area);
  const focus = vi.spyOn(area, "focus");

  await focusCommitUi();

  expect(layout.leftOpen).toBe(true);
  expect(layout.commitControlsHidden).toBe(false);
  expect(focus).toHaveBeenCalledOnce();
});

it("does not force leftOpen while Commit TW is floating", async () => {
  layout.commitTwMode = "float";
  await focusCommitUi();
  expect(layout.leftOpen).toBe(false);
  expect(layout.commitControlsHidden).toBe(false);
});
