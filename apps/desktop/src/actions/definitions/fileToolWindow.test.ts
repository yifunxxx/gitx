import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { registerM7Actions } from "./m7";
import { getAction, runAction, searchActions } from "../registry";
import { useLayoutStore } from "@/stores/layoutStore";
import { SETTINGS_PAGES } from "@/features/settings/schema";
import { i18n } from "@/i18n";
import type { ActionContext } from "../types";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const ctx: ActionContext = { repoIds: [], selection: {}, source: "palette", place: "FindAction" };
it("registers workspace-wide file search on Ctrl/Cmd+P without requiring Git", () => {
  const action = getAction("File.GoToFile")!;
  expect(action.enabled?.(ctx)).toBe(false);
  useWorkspaceStore().folderPath = "C:/plain";
  expect(action.enabled?.(ctx)).toBe(true);
  expect(action.defaultShortcuts?.win).toEqual(["mod+p"]);
  expect(action.defaultShortcuts?.mac).toEqual(["mod+p"]);
  expect(searchActions("Go to File", ctx).map((entry) => entry.id)).toContain(action.id);
  expect(getAction("File.FindInFiles")?.defaultShortcuts?.win).toEqual(["mod+shift+f"]);
  expect(getAction("File.FindInFiles")?.enabled?.(ctx)).toBe(true);
});
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  registerM7Actions();
});
afterEach(() => {
  disposePinia(pinia);
  document.body.innerHTML = "";
  localStorage.clear();
});

it("finds Show File without a repository and opens and focuses the tree with Alt+1", async () => {
  const layout = useLayoutStore();
  layout.commitTwMode = "float";
  layout.leftOpen = false;
  document.body.innerHTML =
    '<section data-gitx-context="projectFiles"><div role="tree" tabindex="0"></div></section>';
  const tree = document.querySelector<HTMLElement>('[role="tree"]')!;
  const focus = vi.spyOn(tree, "focus");
  expect(searchActions("Show File", ctx).map((action) => action.id)).toContain(
    "ToolWindow.ShowFile",
  );
  expect(getAction("ToolWindow.ShowFile")?.defaultShortcuts?.win).toEqual(["alt+1"]);
  await runAction("ToolWindow.ShowFile", ctx);
  expect(layout.activeLeftTab).toBe("file");
  expect(layout.leftOpen).toBe(true);
  expect(focus).toHaveBeenCalledOnce();
  await runAction("ToolWindow.ShowFile", ctx);
  expect(layout.leftOpen).toBe(true);
});

it("returns to Commit from File with Alt+0 without changing the float preference", async () => {
  const layout = useLayoutStore();
  layout.commitTwMode = "float";
  layout.showLeftTab("file");
  expect(getAction("ToolWindow.ShowCommit")?.defaultShortcuts?.win).toEqual(["alt+0"]);
  await runAction("ToolWindow.ShowCommit", ctx);
  expect(layout.activeLeftTab).toBe("commit");
  expect(layout.commitTwMode).toBe("float");
  expect(layout.leftOpen).toBe(false);
});

it("exposes independent File visibility settings with both translations", () => {
  const page = SETTINGS_PAGES.find((item) => item.id === "project-files")!;
  expect(page.fields.map((field) => field.path)).toEqual([
    "showIgnoredInFileTree",
    "showHiddenInFileTree",
    "compactFileTree",
  ]);
  for (const locale of ["en", "zh-CN"] as const) {
    for (const key of [
      page.titleKey,
      ...page.fields.map((field) => field.titleKey),
      "toolWindows.file",
      "fileTree.showToolWindow",
    ]) {
      expect(i18n.global.te(key, locale), `${locale}: ${key}`).toBe(true);
    }
  }
});
