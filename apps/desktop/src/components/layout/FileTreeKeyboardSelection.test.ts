import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import FileToolWindow from "./FileToolWindow.vue";
import { useFileTreeStore } from "@/stores/fileTreeStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { FsEntry } from "@/lib/backend";

const m = vi.hoisted(() => ({
  backend: { workspaceOpen: vi.fn(), workspaceRecent: vi.fn(), fsReadDir: vi.fn() },
  run: vi.fn(),
  open: vi.fn(),
  clipboard: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m.backend }));
vi.mock("vue-i18n", async (original) => ({
  ...(await original<typeof import("vue-i18n")>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock("@/stores/layoutStore", () => ({
  useLayoutStore: () => ({ activeLeftTab: "file", leftOpen: true }),
}));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ snapshot: null }) }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({ open: m.open }) }));
vi.mock("@/stores/fileOperationsStore", () => ({
  useFileOperationsStore: () => ({ busy: false, run: m.run }),
}));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/features/commit/openChangeDiff", () => ({ openChangeDiff: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("@/lib/backend/bindings", () => ({ commands: {} }));
vi.mock("@/lib/utils", async (original) => ({
  ...(await original<typeof import("@/lib/utils")>()),
  isTauri: () => false,
}));

let pinia: ReturnType<typeof createPinia>;
let wrapper: VueWrapper;
let files: ReturnType<typeof useFileTreeStore>;
const entry = (path: string, kind: "file" | "directory" = "file"): FsEntry => ({
  path,
  name: path.split("/").at(-1)!,
  kind,
});
const row = (path: string) => wrapper.get(`[role="treeitem"][data-path="${path}"]`);
const tree = () => wrapper.get('[role="tree"]');
const command = (key: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (button) => button.textContent === key,
  )!;
async function deselectLast() {
  await row("a.txt").trigger("click");
  await row("b.txt").trigger("click", { ctrlKey: true });
  await row("b.txt").trigger("click", { ctrlKey: true });
  expect(files.selectedPath).toBe("b.txt");
  expect(files.selectedPaths).toEqual(["a.txt"]);
  expect(row("a.txt").attributes("aria-selected")).toBe("true");
  expect(row("b.txt").attributes("aria-selected")).toBe("false");
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(m.clipboard);
  pinia = createPinia();
  setActivePinia(pinia);
  m.backend.workspaceOpen.mockResolvedValue({
    path: "C:/plain",
    isRepo: false,
    gitDir: null,
    toplevel: null,
  });
  m.backend.workspaceRecent.mockResolvedValue({ paths: [] });
  m.backend.fsReadDir.mockResolvedValue([
    entry("first", "directory"),
    entry("a.txt"),
    entry("b.txt"),
  ]);
  await useWorkspaceStore().openFolder("C:/plain");
  files = useFileTreeStore();
  await files.loadRoot();
  wrapper = mount(FileToolWindow, { attachTo: document.body, global: { plugins: [pinia] } });
  await flushPromises();
});
afterEach(() => {
  wrapper?.unmount();
  disposePinia(pinia);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("renames the sole selected file after Ctrl deselects the focused file", async () => {
  await deselectLast();
  await tree().trigger("keydown", { key: "F2" });
  expect(m.run).toHaveBeenCalledExactlyOnceWith("rename", ["a.txt"]);
});

it.each([{ key: "F10", shiftKey: true }, { key: "ContextMenu" }])(
  "makes the keyboard context target match the mouse context selection (%j)",
  async (keys) => {
    await deselectLast();
    await tree().trigger("keydown", keys);
    await flushPromises();
    expect(files.selectedPaths).toEqual(["b.txt"]);
    command("commitTw.copyRelativePath").click();
    await flushPromises();
    expect(m.clipboard).toHaveBeenCalledExactlyOnceWith("b.txt");
  },
);

it("moves focus to a surviving selection after external removal before F2", async () => {
  await row("a.txt").trigger("click");
  await row("b.txt").trigger("click", { ctrlKey: true });
  m.backend.fsReadDir.mockResolvedValue([entry("first", "directory"), entry("a.txt")]);
  await files.refreshExpanded();
  await flushPromises();
  expect(files.selectedPaths).toEqual(["a.txt"]);
  expect(files.selectedPath).toBe("a.txt");
  expect(tree().attributes("aria-activedescendant")).toBe(row("a.txt").attributes("id"));
  await tree().trigger("keydown", { key: "F2" });
  expect(m.run).toHaveBeenCalledExactlyOnceWith("rename", ["a.txt"]);
});

it("does not create inside an unrelated first directory after filtering the focus away", async () => {
  await row("b.txt").trigger("click");
  await wrapper.get('input[type="search"]').setValue("first");
  expect(files.selectedPaths).toEqual([]);
  expect(files.selectedPath).toBeNull();
  await wrapper.get('[aria-label="fileOps.createFile"]').trigger("click");
  expect(m.run).toHaveBeenCalledExactlyOnceWith("createFile", [""]);
});

it("does not restore a hidden Shift selection anchor when the filter is cleared", async () => {
  await row("b.txt").trigger("click");
  await wrapper.get('input[type="search"]').setValue("first");
  await wrapper.get('input[type="search"]').setValue("");
  await row("a.txt").trigger("click", { shiftKey: true });
  expect(files.selectedPaths).toEqual(["a.txt"]);
});

it("keeps a keyboard menu's existing multi-selection when its focused row remains selected", async () => {
  await row("a.txt").trigger("click");
  await row("b.txt").trigger("click", { ctrlKey: true });
  await tree().trigger("keydown", { key: "F10", shiftKey: true });
  await flushPromises();
  expect(files.selectedPaths).toEqual(["a.txt", "b.txt"]);
  expect(command("fileOps.rename").disabled).toBe(true);
  command("commitTw.copyRelativePath").click();
  await flushPromises();
  expect(m.clipboard).toHaveBeenCalledExactlyOnceWith("a.txt\nb.txt");
});

it("ignores F2 with no selected files and preserves the active unselected row", async () => {
  await row("a.txt").trigger("click");
  await row("a.txt").trigger("click", { ctrlKey: true });
  expect(files.selectedPaths).toEqual([]);
  await tree().trigger("keydown", { key: "F2" });
  expect(m.run).not.toHaveBeenCalled();
  expect(files.selectedPath).toBe("a.txt");
});

it("selects the active first row before a keyboard menu when no selection exists", async () => {
  expect(files.selectedPaths).toEqual([]);
  await tree().trigger("keydown", { key: "ContextMenu" });
  await flushPromises();
  expect(files.selectedPaths).toEqual(["first"]);
  command("fileOps.rename").click();
  await flushPromises();
  expect(m.run).toHaveBeenCalledExactlyOnceWith("rename", ["first"]);
});

it("keeps ArrowLeft collapse focused and selected on the parent", async () => {
  m.backend.fsReadDir.mockResolvedValue([entry("first/child.txt")]);
  await row("first").trigger("click");
  await flushPromises();
  await row("first/child.txt").trigger("click");
  await tree().trigger("keydown", { key: "ArrowLeft" });
  await tree().trigger("keydown", { key: "ArrowLeft" });
  expect(files.rows.map((row) => row.path)).toEqual(["first", "a.txt", "b.txt"]);
  expect(files.selectedPath).toBe("first");
  expect(files.selectedPaths).toEqual(["first"]);
});

it("selects the collapsed parent when an external collapse hides a focused child", async () => {
  m.backend.fsReadDir.mockResolvedValue([entry("first/child.txt")]);
  await row("first").trigger("click");
  await flushPromises();
  await row("first/child.txt").trigger("click");
  files.collapse("first");
  await flushPromises();
  expect(files.selectedPath).toBe("first");
  expect(files.selectedPaths).toEqual(["first"]);
});
