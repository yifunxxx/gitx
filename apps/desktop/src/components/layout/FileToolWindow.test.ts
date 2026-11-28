import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import FileToolWindow from "./FileToolWindow.vue";
import type { FileTreeRow } from "@/stores/fileTreeStore";
import type { FileChange } from "@/lib/backend";
import { terminalDirectoryRequests } from "@/features/terminal/terminalDirectoryRequest";
import { activeFileDrag, endFileDrag } from "@/features/file-tree/fileDrag";

const mocks = vi.hoisted(() => ({
  tree: {} as any,
  ws: {} as any,
  layout: {} as any,
  changes: {} as any,
  viewer: {} as any,
  diffs: {} as any,
  open: vi.fn(),
  diff: vi.fn(),
  history: vi.fn(),
  toast: vi.fn(),
  reveal: vi.fn(),
  revealPath: vi.fn(),
  openDirectory: vi.fn(),
  clipboard: vi.fn(),
  operation: vi.fn(),
  operations: {} as any,
  showLeftTab: vi.fn(),
  fsReadDir: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ fsReadDir: mocks.fsReadDir }) }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock("vue-i18n", async (original) => ({
  ...(await original<typeof import("vue-i18n")>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/stores/fileTreeStore", () => ({ useFileTreeStore: () => mocks.tree }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => mocks.viewer }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => mocks.diffs }));
vi.mock("@/stores/fileOperationsStore", () => ({
  useFileOperationsStore: () => mocks.operations,
}));
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: () => ({ openFileHistory: mocks.history }),
}));
vi.mock("@/features/commit/openChangeDiff", () => ({ openChangeDiff: mocks.diff }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: mocks.reveal }));
vi.mock("@/lib/backend/bindings", () => ({
  commands: { workspaceOpenDirectory: mocks.openDirectory },
}));
vi.mock("@/lib/utils", async (original) => ({
  ...(await original<typeof import("@/lib/utils")>()),
  isTauri: () => true,
}));

const row = (
  path: string,
  kind: "file" | "directory" = "file",
  extra: Partial<FileTreeRow> = {},
): FileTreeRow => ({
  key: `${kind}:${path}`,
  path,
  name: path.split("/").at(-1)!,
  kind,
  depth: path.split("/").length - 1,
  expanded: false,
  loading: false,
  error: null,
  ...extra,
});
const change = (path: string, extra: Partial<FileChange> = {}): FileChange => ({
  path,
  origPath: null,
  indexStatus: ".",
  worktreeStatus: "M",
  kind: "modified",
  ...extra,
});
let wrapper: VueWrapper;
const create = () => {
  wrapper = mount(FileToolWindow, { attachTo: document.body });
  return wrapper;
};
const item = (path: string) => wrapper.get(`[role="treeitem"][data-path="${path}"]`);
const tree = () => wrapper.get('[role="tree"]');
function command(label: string) {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (button) => button.textContent === `commitTw.${label}`,
  )!;
}
async function menu(path: string) {
  await item(path).trigger("contextmenu", { clientX: 30, clientY: 40 });
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fsReadDir.mockReset().mockResolvedValue([]);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(mocks.clipboard);
  terminalDirectoryRequests.value = [];
  mocks.tree = reactive({
    rows: [row("src", "directory"), row("changed.txt"), row("clean.txt")],
    selectedPath: null,
    selectedPaths: [] as string[],
    select(path: string, options: { toggle?: boolean } = {}) {
      this.selectedPath = path as any;
      this.selectedPaths = options.toggle ? [...this.selectedPaths, path] : [path];
    },
    selectAll() {
      this.selectedPaths = this.rows.map((row) => row.path);
    },
    filter: "",
    loading: false,
    error: null,
    initialized: true,
    loadRoot: vi.fn(),
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
    refreshExpanded: vi.fn(),
    revealPath: mocks.revealPath,
  });
  mocks.ws = reactive({
    folderPath: "C:/project",
    repoPath: "C:/project",
    repoId: "repo",
    isRepo: true,
    navigation: 1,
    applied: 1,
    navigationToken() {
      return this.navigation;
    },
    appliedOpenToken() {
      return this.applied;
    },
  });
  mocks.layout = reactive({
    activeLeftTab: "file",
    leftOpen: true,
    bottomOpen: false,
    activeBottomTab: "log",
    activeEditorKind: "welcome",
    showLeftTab: mocks.showLeftTab,
  });
  mocks.viewer = reactive({
    open: mocks.open,
    tabs: [] as { id: string; path: string; folderPath?: string }[],
    activeId: null as string | null,
  });
  mocks.diffs = reactive({
    tabs: [] as { id: string; path: string }[],
    activeId: null as string | null,
  });
  mocks.changes = reactive({ snapshot: { repoId: "repo", files: [change("changed.txt")] } });
  mocks.operations = reactive({ busy: false, activityTitle: "", run: mocks.operation });
  mocks.revealPath.mockResolvedValue(true);
});
afterEach(() => {
  endFileDrag();
  wrapper?.unmount();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("keeps multiselection in context menus and copies all selected paths", async () => {
  create();
  await item("changed.txt").trigger("click");
  await item("clean.txt").trigger("click", { ctrlKey: true });
  await menu("changed.txt");
  command("copyRelativePath").click();
  await flushPromises();
  expect(mocks.clipboard).toHaveBeenCalledWith("changed.txt\nclean.txt");
  expect(mocks.tree.selectedPaths).toHaveLength(2);
});

it("disables locate until an editor file is active, then reveals and scrolls to it", async () => {
  create();
  const locate = wrapper.get('[aria-label="fileTree.locateCurrent"]');
  expect(locate.attributes("disabled")).toBeDefined();
  mocks.viewer.tabs = [{ id: "file:changed.txt", path: "changed.txt" }];
  mocks.viewer.activeId = "file:changed.txt";
  mocks.layout.activeEditorKind = "file";
  await nextTick();
  expect(locate.attributes("disabled")).toBeUndefined();
  await locate.trigger("click");
  await flushPromises();
  expect(mocks.showLeftTab).toHaveBeenCalledWith("file");
  expect(mocks.revealPath).toHaveBeenCalledWith("changed.txt", expect.any(Function));
});

it("locates the active diff path and reports when the tree has no match", async () => {
  create();
  mocks.diffs.tabs = [{ id: "diff:src/x", path: "src/nested.txt" }];
  mocks.diffs.activeId = "diff:src/x";
  mocks.layout.activeEditorKind = "diff";
  mocks.revealPath.mockResolvedValueOnce(false);
  await nextTick();
  await wrapper.get('[aria-label="fileTree.locateCurrent"]').trigger("click");
  await flushPromises();
  expect(mocks.revealPath).toHaveBeenCalledWith("src/nested.txt", expect.any(Function));
  expect(mocks.toast).toHaveBeenCalledWith({ title: "fileTree.locateUnavailable" });
});

it.each(["navigation", "reopen", "editor", "hidden", "unmount"])(
  "ignores obsolete locate feedback after %s",
  async (reason) => {
    let finish!: (found: boolean) => void;
    mocks.revealPath.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    mocks.viewer.tabs = [{ id: "file:changed.txt", path: "changed.txt" }];
    mocks.viewer.activeId = "file:changed.txt";
    mocks.layout.activeEditorKind = "file";
    create();
    await wrapper.get('[aria-label="fileTree.locateCurrent"]').trigger("click");
    if (reason === "navigation") mocks.ws.navigation++;
    if (reason === "reopen") mocks.ws.applied++;
    if (reason === "editor") mocks.layout.activeEditorKind = "welcome";
    if (reason === "hidden") mocks.layout.leftOpen = false;
    if (reason === "unmount") wrapper.unmount();
    finish(false);
    await flushPromises();
    expect(mocks.toast).not.toHaveBeenCalled();
  },
);

it("allows a new editor locate and keeps its busy state when the old request finishes", async () => {
  let finishOld!: (found: boolean) => void;
  let finishNew!: (found: boolean) => void;
  mocks.revealPath
    .mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishOld = resolve;
      }),
    )
    .mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishNew = resolve;
      }),
    );
  mocks.viewer.tabs = [
    { id: "file:changed.txt", path: "changed.txt" },
    { id: "file:clean.txt", path: "clean.txt" },
  ];
  mocks.viewer.activeId = "file:changed.txt";
  mocks.layout.activeEditorKind = "file";
  create();
  const locate = wrapper.get('[aria-label="fileTree.locateCurrent"]');
  await locate.trigger("click");
  expect(locate.attributes("disabled")).toBeDefined();
  mocks.viewer.activeId = "file:clean.txt";
  await nextTick();
  expect(locate.attributes("disabled")).toBeUndefined();
  await locate.trigger("click");
  finishOld(false);
  await flushPromises();
  expect(locate.attributes("disabled")).toBeDefined();
  expect(mocks.toast).not.toHaveBeenCalled();
  finishNew(true);
  await flushPromises();
  expect(locate.attributes("disabled")).toBeUndefined();
});

it("does not take focus back from a field used while locate was loading", async () => {
  let finish!: (found: boolean) => void;
  mocks.revealPath.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      finish = resolve;
    }),
  );
  mocks.viewer.tabs = [{ id: "file:changed.txt", path: "changed.txt" }];
  mocks.viewer.activeId = "file:changed.txt";
  mocks.layout.activeEditorKind = "file";
  create();
  const locate = wrapper.get<HTMLButtonElement>('[aria-label="fileTree.locateCurrent"]');
  locate.element.focus();
  await locate.trigger("click");
  const field = wrapper.get<HTMLInputElement>('input[type="search"]');
  field.element.focus();
  finish(true);
  await flushPromises();
  expect(document.activeElement).toBe(field.element);
});

it("focuses the located tree after the browser blurs the disabled locate button", async () => {
  let finish!: (found: boolean) => void;
  mocks.revealPath.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      finish = resolve;
    }),
  );
  mocks.viewer.tabs = [{ id: "file:changed.txt", path: "changed.txt" }];
  mocks.viewer.activeId = "file:changed.txt";
  mocks.layout.activeEditorKind = "file";
  create();
  const locate = wrapper.get<HTMLButtonElement>('[aria-label="fileTree.locateCurrent"]');
  locate.element.focus();
  await locate.trigger("click");
  expect(locate.element.disabled).toBe(true);
  locate.element.blur();
  finish(true);
  await flushPromises();
  expect(document.activeElement).toBe(tree().element);
});

it.each(["editor", "filter", "selection"])(
  "stops the real tree reveal when the user changes %s during a directory read",
  async (interaction) => {
    setActivePinia(createPinia());
    const { useFileTreeStore } =
      await vi.importActual<typeof import("@/stores/fileTreeStore")>("@/stores/fileTreeStore");
    mocks.tree = useFileTreeStore();
    mocks.fsReadDir.mockResolvedValueOnce([row("src", "directory"), row("keep.txt")]);
    await mocks.tree.loadRoot();
    let finish!: (rows: FileTreeRow[]) => void;
    mocks.fsReadDir.mockReturnValueOnce(
      new Promise<FileTreeRow[]>((resolve) => {
        finish = resolve;
      }),
    );
    mocks.viewer.tabs = [{ id: "target", path: "src/target.ts" }];
    mocks.viewer.activeId = "target";
    mocks.layout.activeEditorKind = "file";
    create();
    await wrapper.get('[aria-label="fileTree.locateCurrent"]').trigger("click");
    await vi.waitFor(() => expect(mocks.fsReadDir).toHaveBeenCalledTimes(2));
    if (interaction === "editor") mocks.viewer.activeId = null;
    if (interaction === "filter") await wrapper.get('input[type="search"]').setValue("keep");
    if (interaction === "selection") await item("keep.txt").trigger("click");
    finish([row("src/target.ts")]);
    await flushPromises();
    expect(mocks.tree.selectedPaths).toEqual(interaction === "selection" ? ["keep.txt"] : []);
    expect(mocks.tree.filter).toBe(interaction === "filter" ? "keep" : "");
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(
      wrapper.get('[aria-label="fileTree.locateCurrent"]').find(".animate-spin").exists(),
    ).toBe(false);
  },
);

it("shows active file work and disables mutation actions until it finishes", async () => {
  create();
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  mocks.operations.busy = true;
  await nextTick();
  // A pending confirmation alone must not claim that disk work has started.
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  mocks.operations.activityTitle = "Copying files";
  await nextTick();
  expect(wrapper.get('[role="status"]').text()).toBe("Copying files");
  expect(wrapper.get('[aria-label="fileOps.createFile"]').attributes("disabled")).toBeDefined();
  expect(wrapper.get('[aria-label="fileOps.delete"]').attributes("disabled")).toBeDefined();
  await menu("changed.txt");
  const rename = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (button) => button.textContent === "fileOps.rename",
  )!;
  expect(rename.disabled).toBe(true);
  mocks.operations.busy = false;
  mocks.operations.activityTitle = "";
  await nextTick();
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.get('[aria-label="fileOps.createFile"]').attributes("disabled")).toBeUndefined();
});
it("exposes toolbar delete for the current selection", async () => {
  create();
  const trash = wrapper.get('[aria-label="fileOps.delete"]');
  expect(trash.attributes("disabled")).toBeDefined();
  await item("changed.txt").trigger("click");
  await nextTick();
  expect(trash.attributes("disabled")).toBeUndefined();
  await trash.trigger("click");
  expect(mocks.operation).toHaveBeenCalledWith("delete", ["changed.txt"]);
});
it("handles a large selection without repeatedly scanning every selected path", async () => {
  const count = 512;
  mocks.tree.rows = Array.from({ length: count }, (_, i) => row(`file-${i}.txt`));
  const selected = mocks.tree.rows.map((item: FileTreeRow) => item.path).reverse();
  let selectionReads = 0;
  // Count indexed reads, not wall time: menu construction should scale with
  // rows + selection, including membership checks for rendered rows.
  mocks.tree.selectedPaths = new Proxy(selected, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) selectionReads++;
      return Reflect.get(target, key, receiver);
    },
  });
  create();
  await menu("file-0.txt");
  command("copyRelativePath").click();
  await flushPromises();
  expect(mocks.clipboard).toHaveBeenCalledWith(
    mocks.tree.rows.map((item: FileTreeRow) => item.path).join("\n"),
  );
  expect(mocks.tree.selectedPaths).toHaveLength(count);
  expect(selectionReads).toBeLessThan(count * 20);
});

it("keeps batch order and live selection across menus, mutation and dragging", async () => {
  create();
  mocks.tree.selectedPaths = ["clean.txt", "changed.txt"];
  await nextTick();
  expect(item("changed.txt").attributes("aria-selected")).toBe("true");
  expect(item("clean.txt").attributes("aria-selected")).toBe("true");
  await menu("changed.txt");
  expect(command("showDiff").disabled).toBe(true);
  expect(command("showHistory").disabled).toBe(true);
  mocks.tree.selectedPaths.splice(0, 1);
  await nextTick();
  expect(item("clean.txt").attributes("aria-selected")).toBe("false");
  expect(command("showDiff").disabled).toBe(false);
  command("copyRelativePath").click();
  await flushPromises();
  expect(mocks.clipboard).toHaveBeenLastCalledWith("changed.txt");
  await tree().trigger("keydown", { key: "a", ctrlKey: true });
  const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
  await item("changed.txt").trigger("dragstart", { dataTransfer });
  expect(activeFileDrag.value?.paths).toEqual(["src", "changed.txt", "clean.txt"]);
  mocks.tree.rows = [row("clean.txt"), row("changed.txt")];
  await nextTick();
  await menu("changed.txt");
  command("copyRelativePath").click();
  await flushPromises();
  expect(mocks.clipboard).toHaveBeenLastCalledWith("clean.txt\nchanged.txt");
  mocks.tree.selectedPaths = [];
  await nextTick();
  expect(item("changed.txt").attributes("aria-selected")).toBe("false");
  await item("changed.txt").trigger("dragstart", { dataTransfer });
  expect(activeFileDrag.value?.paths).toEqual(["changed.txt"]);
  await menu("clean.txt");
  expect(mocks.tree.selectedPaths).toEqual(["clean.txt"]);
});

it("retains selection highlighting after virtual scrolling and clears it after a reset", async () => {
  mocks.tree.rows = Array.from({ length: 1000 }, (_, i) => row(`file-${i}.txt`));
  create();
  await tree().trigger("keydown", { key: "a", ctrlKey: true });
  const port = wrapper.get(".overflow-auto").element;
  port.scrollTop = 2400;
  port.dispatchEvent(new Event("scroll"));
  await nextTick();
  expect(wrapper.findAll('[role="treeitem"]').length).toBeLessThan(100);
  expect(item("file-100.txt").attributes("aria-selected")).toBe("true");
  mocks.tree.selectedPaths = ["file-101.txt"];
  await nextTick();
  expect(item("file-100.txt").attributes("aria-selected")).toBe("false");
  expect(item("file-101.txt").attributes("aria-selected")).toBe("true");
  mocks.tree.rows = [row("next.txt")];
  mocks.tree.selectedPaths = [];
  mocks.ws.navigation++;
  await flushPromises();
  expect(item("next.txt").attributes("aria-selected")).toBe("false");
});

it.runIf(process.env.GITX_QA_FILE_SELECTION_COST === "1")(
  "measures menu and drag preparation for large selections",
  async () => {
    const samples = [];
    for (const count of [1000, 5000, 20000]) {
      mocks.tree.rows = Array.from({ length: count }, (_, i) => row(`file-${i}.txt`));
      mocks.tree.selectedPaths = [];
      create();
      for (let round = 0; round < 3; round++) {
        mocks.tree.selectedPaths = mocks.tree.rows.map((item: FileTreeRow) => item.path).reverse();
        const menuStart = performance.now();
        await menu("file-0.txt");
        const menuMs = performance.now() - menuStart;
        command("copyRelativePath").click();
        await flushPromises();
        expect(mocks.clipboard.mock.lastCall![0].split("\n")).toHaveLength(count);
        mocks.tree.selectedPaths = [...mocks.tree.selectedPaths].reverse();
        const dragStart = performance.now();
        await item("file-0.txt").trigger("dragstart", {
          dataTransfer: { setData: vi.fn(), effectAllowed: "" },
        });
        const dragMs = performance.now() - dragStart;
        expect(activeFileDrag.value?.paths).toHaveLength(count);
        endFileDrag();
        samples.push({ count, round, menuMs, dragMs });
      }
      wrapper.unmount();
    }
    console.log("QA105_FILE_SELECTION_COST", JSON.stringify(samples));
  },
  120000,
);
it("drops selected files into a directory, supports copy and rejects stale navigation", async () => {
  create();
  await item("changed.txt").trigger("click");
  const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  await item("changed.txt").trigger("dragstart", { dataTransfer });
  expect(activeFileDrag.value?.paths).toEqual(["changed.txt"]);
  await item("src").trigger("drop", { dataTransfer, ctrlKey: true });
  expect(mocks.operation).toHaveBeenCalledWith("copy", ["changed.txt"], "src");
  await item("changed.txt").trigger("dragstart", { dataTransfer });
  mocks.ws.navigation++;
  await item("src").trigger("drop", { dataTransfer });
  expect(mocks.operation).toHaveBeenCalledTimes(1);
});

it("loads only when File is shown and reloads a reopened same-path workspace", async () => {
  mocks.layout.activeLeftTab = "commit";
  create();
  expect(mocks.tree.loadRoot).not.toHaveBeenCalled();
  mocks.layout.activeLeftTab = "file";
  await nextTick();
  expect(mocks.tree.loadRoot).toHaveBeenCalledTimes(1);
  mocks.ws.applied++;
  await nextTick();
  expect(mocks.tree.loadRoot).toHaveBeenCalledTimes(2);
});

it("single click only selects; double-click and Enter open an editable file, F4 opens Diff", async () => {
  create();
  await item("changed.txt").trigger("click");
  expect(mocks.tree.selectedPath).toBe("changed.txt");
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.diff).not.toHaveBeenCalled();
  await item("changed.txt").trigger("dblclick");
  expect(mocks.open).toHaveBeenCalledWith("changed.txt", { folderPath: "C:/project" });
  await tree().trigger("keydown", { key: "Enter" });
  expect(mocks.open).toHaveBeenCalledTimes(2);
  await tree().trigger("keydown", { key: "F4" });
  expect(mocks.diff).toHaveBeenCalledWith("changed.txt", "unstaged");
  await tree().trigger("keydown", { key: "Enter", repeat: true });
  await tree().trigger("keydown", { key: "F4", isComposing: true });
  expect(mocks.open).toHaveBeenCalledTimes(2);
  expect(mocks.diff).toHaveBeenCalledTimes(1);
});

it("opens non-Git files and disables Git-only commands", async () => {
  mocks.ws.isRepo = false;
  create();
  await item("changed.txt").trigger("dblclick");
  expect(mocks.open).toHaveBeenCalledWith("changed.txt", { folderPath: "C:/project" });
  await menu("changed.txt");
  expect(command("showDiff").disabled).toBe(true);
  expect(command("showHistory").disabled).toBe(true);
  command("showDiff").click();
  expect(mocks.diff).not.toHaveBeenCalled();
});

it("preserves the row node on a status update and chooses staged-only Diff", async () => {
  create();
  const element = item("changed.txt").element;
  expect(item("changed.txt").get("[data-file-status]").text()).toBe("M");
  mocks.changes.snapshot.files = [
    change("changed.txt", { kind: "added", indexStatus: "A", worktreeStatus: "." }),
  ];
  await nextTick();
  expect(item("changed.txt").element).toBe(element);
  expect(item("changed.txt").get("[data-file-status]").text()).toBe("A");
  await item("changed.txt").trigger("click");
  await tree().trigger("keydown", { key: "F4" });
  expect(mocks.diff).toHaveBeenCalledWith("changed.txt", "staged");
  await menu("clean.txt");
  expect(command("showDiff").disabled).toBe(true);
  expect(command("showHistory").disabled).toBe(false);
});

it("maps workspace rows into the active repository and ignores other repositories' status", async () => {
  mocks.ws.folderPath = "C:/";
  mocks.tree.rows = [row("project/changed.txt")];
  create();
  await item("project/changed.txt").trigger("click");
  await tree().trigger("keydown", { key: "F4" });
  expect(mocks.diff).toHaveBeenCalledWith("changed.txt", "unstaged");
  await menu("project/changed.txt");
  command("showHistory").click();
  expect(mocks.history).toHaveBeenCalledWith("changed.txt");
  mocks.changes.snapshot.repoId = "other";
  await nextTick();
  expect(item("project/changed.txt").find("[data-file-status]").exists()).toBe(false);
});

it("navigates and expands directories with arrows, while directory menus omit file actions", async () => {
  mocks.tree.rows = [
    row("src", "directory", { expanded: true }),
    row("src/child.txt"),
    row("clean.txt"),
  ];
  create();
  await tree().trigger("keydown", { key: "ArrowRight" });
  expect(mocks.tree.selectedPath).toBe("src/child.txt");
  await tree().trigger("keydown", { key: "ArrowLeft" });
  expect(mocks.tree.selectedPath).toBe("src");
  await tree().trigger("keydown", { key: "ArrowLeft" });
  expect(mocks.tree.collapse).toHaveBeenCalledWith("src");
  await menu("src");
  expect(command("openFile")).toBeUndefined();
  expect(command("showDiff")).toBeUndefined();
  expect(command("showHistory")).toBeUndefined();
  command("openExplorer").click();
  await flushPromises();
  expect(mocks.openDirectory).toHaveBeenCalledWith("C:/project/src");
});

it("offers a keyboard context menu and routes Terminal, Reveal and copy to the selected path", async () => {
  create();
  await item("changed.txt").trigger("click");
  await tree().trigger("keydown", { key: "F10", shiftKey: true });
  await flushPromises();
  expect(command("openFile")).toBeTruthy();
  command("openTerminal").click();
  expect(terminalDirectoryRequests.value[0]?.cwd).toBe("C:/project/");
  expect(mocks.layout.activeBottomTab).toBe("terminal");
  await menu("changed.txt");
  command("openExplorer").click();
  expect(mocks.reveal).toHaveBeenCalledWith("C:/project/changed.txt");
  await menu("changed.txt");
  command("copyPath").click();
  expect(mocks.clipboard).toHaveBeenCalledWith("C:/project/changed.txt");
  await menu("changed.txt");
  command("copyRelativePath").click();
  expect(mocks.clipboard).toHaveBeenCalledWith("changed.txt");
});

it("closes stale menus on navigation, row removal and tool-window switches", async () => {
  create();
  await menu("changed.txt");
  const oldCommand = command("openFile");
  mocks.ws.navigation++;
  oldCommand.click();
  await nextTick();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(command("openFile")).toBeUndefined();
  await menu("changed.txt");
  mocks.tree.rows = [row("src", "directory")];
  await nextTick();
  expect(command("openFile")).toBeUndefined();
  await menu("src");
  mocks.layout.activeLeftTab = "commit";
  await nextTick();
  expect(command("openTerminal")).toBeUndefined();
});

it("reports failures, supports root and child retry, and uses its own filter scope", async () => {
  mocks.tree.rows = [];
  mocks.tree.error = "Denied";
  create();
  expect(wrapper.text()).toContain("Denied");
  await wrapper.get("button:not([aria-label])").trigger("click");
  expect(mocks.tree.loadRoot).toHaveBeenCalledTimes(2);
  mocks.tree.error = null;
  mocks.tree.rows = [row("src", "directory", { error: "Denied", expanded: true })];
  await nextTick();
  await item("src").get('button[aria-label="fileTree.retryDirectory"]').trigger("click");
  expect(mocks.tree.expand).toHaveBeenCalledWith("src");
  await wrapper.get('input[type="search"]').setValue("needle");
  expect(mocks.tree.filter).toBe("needle");
  expect(wrapper.attributes("data-gitx-context")).toBe("projectFiles");
});

it("mounts a bounded number of rows in a large directory and preserves the scroll anchor", async () => {
  mocks.tree.rows = Array.from({ length: 4000 }, (_, i) => row(`file-${i}.txt`));
  create();
  expect(wrapper.findAll('[role="treeitem"]').length).toBeLessThan(100);
  const port = wrapper.get(".overflow-auto").element;
  port.scrollTop = 2400;
  port.dispatchEvent(new Event("scroll"));
  await nextTick();
  mocks.tree.rows = [row("new.txt"), ...mocks.tree.rows];
  await flushPromises();
  expect(port.scrollTop).toBe(2424);
});

it("shows the no-folder empty state and does not request a directory", () => {
  mocks.ws.folderPath = null;
  create();
  expect(wrapper.text()).toContain("empty.noFolder");
  expect(mocks.tree.loadRoot).not.toHaveBeenCalled();
  expect(wrapper.find('input[type="search"]').exists()).toBe(false);
});

it("owns its context event so the global Changes menu cannot act on this file", async () => {
  create();
  const listener = vi.fn();
  document.addEventListener("contextmenu", listener);
  try {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 30,
    });
    item("changed.txt").element.dispatchEvent(event);
    await nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener("contextmenu", listener);
  }
});

it("reports current action errors but suppresses a delayed result after switching workspace", async () => {
  create();
  mocks.reveal.mockRejectedValueOnce(new Error("permission denied"));
  await menu("changed.txt");
  command("openExplorer").click();
  await flushPromises();
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({ title: "fileTree.actionFailed" }),
  );
  mocks.toast.mockClear();
  let resolve!: () => void;
  mocks.clipboard.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await menu("changed.txt");
  command("copyPath").click();
  mocks.ws.navigation++;
  resolve();
  await flushPromises();
  expect(mocks.toast).not.toHaveBeenCalled();
});
