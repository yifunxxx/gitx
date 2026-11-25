import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
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
  open: vi.fn(),
  diff: vi.fn(),
  history: vi.fn(),
  toast: vi.fn(),
  reveal: vi.fn(),
  openDirectory: vi.fn(),
  clipboard: vi.fn(),
  operation: vi.fn(),
}));
vi.mock("vue-i18n", async (original) => ({
  ...(await original<typeof import("vue-i18n")>()),
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/stores/fileTreeStore", () => ({ useFileTreeStore: () => mocks.tree }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({ open: mocks.open }) }));
vi.mock("@/stores/fileOperationsStore", () => ({
  useFileOperationsStore: () => ({ busy: false, run: mocks.operation }),
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
  });
  mocks.changes = reactive({ snapshot: { repoId: "repo", files: [change("changed.txt")] } });
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
