import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { reactive } from "vue";
import CommitToolWindow from "./CommitToolWindow.vue";
import ChangesTree from "@/features/commit/ChangesTree.vue";
import { terminalDirectoryRequests } from "@/features/terminal/terminalDirectoryRequest";

const mocks = vi.hoisted(() => ({
  ws: {} as any,
  changes: {} as any,
  settings: {} as any,
  layout: {
    commitTwMode: "docked" as string,
    leftOpen: true,
    commitControlsHidden: true,
  },
  confirm: vi.fn(),
  prompt: vi.fn(),
  checkout: vi.fn(),
  toast: vi.fn(),
  open: vi.fn(),
  patch: vi.fn(),
  dialog: vi.fn(),
  focusCommitUi: vi.fn(),
  reveal: vi.fn(),
  openDirectory: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => ({}) }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({}) }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => ({ refreshOpState: vi.fn() }) }));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => ({}) }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({ open: mocks.open }) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({}) }));
vi.mock("@/features/commit/focusCommitUi", () => ({ focusCommitUi: mocks.focusCommitUi }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/composables/useConfirm", () => ({
  confirmDialog: mocks.confirm,
  promptDialog: mocks.prompt,
}));
vi.mock("@/composables/useDialog", () => ({ openDialog: mocks.dialog }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ checkoutPathFromRev: mocks.checkout }) }));
vi.mock("@/actions", () => ({ runAction: mocks.patch }));
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: mocks.reveal }));
vi.mock("@/lib/backend/bindings", () => ({
  commands: { workspaceOpenDirectory: mocks.openDirectory },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let wrapper: ReturnType<typeof shallowMount>;
beforeEach(() => {
  vi.resetAllMocks();
  terminalDirectoryRequests.value = [];
  mocks.ws = reactive({
    repoPath: "A",
    repoId: "A",
    toplevel: "A",
    folderPath: "A",
    isRepo: true,
    generation: 1,
    navigationToken() {
      return this.generation;
    },
  });
  mocks.layout = {
    commitTwMode: "docked",
    leftOpen: true,
    commitControlsHidden: true,
  };
  mocks.changes = reactive({
    stagingMode: true,
    loading: false,
    error: null,
    selectedPaths: ["first.txt", "second.txt"],
    selectedSection: "staged",
    staged: [{ path: "first.txt" }, { path: "second.txt" }],
    unstaged: [],
    unversioned: [],
    ignored: [],
    changelists: { lists: [] },
    checkedPaths: [],
    pathsForSection: vi.fn(() => ["first.txt", "second.txt"]),
    refresh: vi.fn(),
    stage: vi.fn(),
    unstage: vi.fn(),
    add: vi.fn(),
    setChecked: vi.fn(),
    rmCached: vi.fn(),
    createChangelist: vi.fn(),
    moveToChangelist: vi.fn(),
  });
  mocks.settings = reactive({
    settings: { stagingMode: true, git: { changesListMode: "tree" } },
    emptySettings: () => ({ stagingMode: true, git: { changesListMode: "tree" } }),
    save: vi.fn(async (next: unknown) => {
      mocks.settings.settings = next;
    }),
  });
  mocks.confirm.mockResolvedValue(true);
  wrapper = shallowMount(CommitToolWindow, {
    global: {
      stubs: {
        Tip: { template: "<div><slot /></div>" },
        Button: { template: "<button><slot /></button>" },
        ContextMenuSurface: {
          props: ["open"],
          template: '<div data-menu v-if="open"><slot /></div>',
        },
      },
    },
  });
});
afterEach(() => wrapper.unmount());
async function openMenu() {
  wrapper.findComponent(ChangesTree).vm.$emit("context", {
    path: "first.txt",
    section: mocks.changes.selectedSection,
    x: 10,
    y: 10,
  });
  await flushPromises();
}
async function click(label: string) {
  await wrapper
    .findAll("button")
    .find((b) => b.text() === label)!
    .trigger("click");
  await flushPromises();
}

it("opens the actually clicked file location when multiple files are selected", async () => {
  mocks.ws.repoPath = "C:/repo";
  mocks.changes.selectedPaths = ["first/a.txt", "second/O'Brien & $x.txt"];
  wrapper.findComponent(ChangesTree).vm.$emit("context", {
    path: "second/O'Brien & $x.txt",
    section: "staged",
    x: 10,
    y: 10,
  });
  await flushPromises();
  await click("commitTw.openExplorer");
  expect(mocks.reveal).toHaveBeenCalledWith("C:/repo/second/O'Brien & $x.txt");
  wrapper.findComponent(ChangesTree).vm.$emit("context", {
    path: "second/O'Brien & $x.txt",
    section: "staged",
    x: 10,
    y: 10,
  });
  await flushPromises();
  await click("commitTw.openTerminal");
  expect(terminalDirectoryRequests.value[0]?.cwd).toBe("C:/repo/second");
  expect(mocks.layout).toMatchObject({ bottomOpen: true, activeBottomTab: "terminal" });
  mocks.ws.generation++;
  expect(terminalDirectoryRequests.value[0]?.current()).toBe(false);
});

it("offers directory location and copy actions without file mutations", async () => {
  mocks.ws.repoPath = "C:/repo";
  mocks.changes.stagingMode = false;
  const context = {
    path: "src/nested",
    directory: true,
    section: "changelist:default",
    x: 10,
    y: 10,
  };
  wrapper.findComponent(ChangesTree).vm.$emit("context", context);
  await flushPromises();
  expect(
    wrapper
      .get("[data-menu]")
      .findAll("button")
      .map((button) => button.text()),
  ).toEqual([
    "commitTw.openExplorer",
    "commitTw.openTerminal",
    "commitTw.copyPath",
    "commitTw.copyRelativePath",
    "actions.refreshStatus",
  ]);
  await click("commitTw.openExplorer");
  expect(mocks.openDirectory).toHaveBeenCalledWith("C:/repo/src/nested");
  wrapper.findComponent(ChangesTree).vm.$emit("context", context);
  await flushPromises();
  await click("commitTw.openTerminal");
  expect(terminalDirectoryRequests.value[0]?.cwd).toBe("C:/repo/src/nested");
});

it.each(["repository", "navigation", "selection", "section"])(
  "closes an open menu after %s changes",
  async (kind) => {
    await openMenu();
    expect(wrapper.find("[data-menu]").exists()).toBe(true);
    if (kind === "repository") mocks.ws.repoPath = "B";
    if (kind === "navigation") mocks.ws.generation++;
    if (kind === "selection") mocks.changes.selectedPaths.splice(0, 1, "other.txt");
    if (kind === "section") mocks.changes.selectedSection = "unstaged";
    await flushPromises();
    expect(wrapper.find("[data-menu]").exists()).toBe(false);
  },
);

it.each(["navigation", "roundtrip", "unmount"])(
  "cancels confirmed rollback after %s invalidates its source",
  async (kind) => {
    const answer = deferred<{ paths: string[] } | null>();
    mocks.dialog.mockReturnValue(answer.promise);
    await openMenu();
    await click("commitTw.rollback");
    if (kind === "navigation") mocks.ws.generation++;
    if (kind === "roundtrip") {
      mocks.ws.repoPath = "B";
      mocks.ws.repoPath = "A";
    }
    if (kind === "unmount") wrapper.unmount();
    answer.resolve({ paths: ["first.txt", "second.txt"] });
    await flushPromises();
    expect(mocks.changes.unstage).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  },
);

it("keeps the original files and section through a rollback confirmation", async () => {
  const answer = deferred<{ paths: string[] } | null>();
  mocks.dialog.mockReturnValue(answer.promise);
  await openMenu();
  await click("commitTw.rollback");
  mocks.changes.selectedPaths.splice(0, 2, "other.txt");
  mocks.changes.selectedSection = "unstaged";
  answer.resolve({ paths: ["first.txt", "second.txt"] });
  await flushPromises();
  expect(mocks.changes.unstage).toHaveBeenCalledWith(["first.txt", "second.txt"]);
  expect(mocks.checkout.mock.calls.map(([arg]) => arg)).toEqual([
    { repoId: "A", path: "A", rev: "HEAD", filePath: "first.txt" },
    { repoId: "A", path: "A", rev: "HEAD", filePath: "second.txt" },
  ]);
});

it.each(["unstage", "checkout"])("stops rollback after navigation during %s", async (step) => {
  const pending = deferred<void>();
  if (step === "unstage") mocks.changes.unstage.mockReturnValue(pending.promise);
  else mocks.checkout.mockReturnValueOnce(pending.promise);
  mocks.dialog.mockResolvedValue({ paths: ["first.txt", "second.txt"] });
  await openMenu();
  await click("commitTw.rollback");
  mocks.ws.repoPath = "B";
  mocks.ws.repoId = "B";
  pending.resolve();
  await flushPromises();
  expect(mocks.checkout).toHaveBeenCalledTimes(step === "checkout" ? 1 : 0);
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("cancels untracking when its confirmation is dismissed", async () => {
  mocks.dialog.mockResolvedValue(null);
  await openMenu();
  await click("commitTw.untrack");
  expect(mocks.changes.rmCached).not.toHaveBeenCalled();
});

it("does not untrack files after its confirmation outlives the repository", async () => {
  const answer = deferred<{ addToGitignore: boolean }>();
  mocks.dialog.mockReturnValue(answer.promise);
  await openMenu();
  await click("commitTw.untrack");
  mocks.ws.generation++;
  answer.resolve({ addToGitignore: true });
  await flushPromises();
  expect(mocks.changes.rmCached).not.toHaveBeenCalled();
});

it.each([true, false])(
  "honors explicit untracking with addToGitignore=%s",
  async (addToGitignore) => {
    mocks.dialog.mockResolvedValue({ addToGitignore });
    await openMenu();
    await click("commitTw.untrack");
    expect(mocks.changes.rmCached).toHaveBeenCalledWith(
      ["first.txt", "second.txt"],
      addToGitignore,
    );
  },
);

it("ignores an already queued menu click after navigation", async () => {
  await openMenu();
  const button = wrapper.findAll("button").find((b) => b.text() === "commitTw.openFile")!;
  mocks.ws.generation++;
  await button.trigger("click");
  expect(mocks.open).not.toHaveBeenCalled();
});

it("closes when a status refresh removes the menu's files from their section", async () => {
  mocks.changes.pathsForSection = vi.fn().mockReturnValue([]);
  await openMenu();
  mocks.changes.snapshot = { files: [] };
  await flushPromises();
  expect(wrapper.find("[data-menu]").exists()).toBe(false);
});

it("Commit Files… stages unstaged paths then focuses the commit UI", async () => {
  mocks.changes.selectedSection = "unstaged";
  mocks.changes.selectedPaths = ["first.txt"];
  await openMenu();
  await click("commitTw.commitFiles");
  expect(mocks.changes.stage).toHaveBeenCalledWith(["first.txt"]);
  expect(mocks.changes.setChecked).not.toHaveBeenCalled();
  expect(mocks.focusCommitUi).toHaveBeenCalledOnce();
});

it("Commit Files… checks paths in changelist mode and focuses the commit UI", async () => {
  mocks.dialog.mockResolvedValue({ paths: ["first.txt", "second.txt"] });
  mocks.changes.stagingMode = false;
  mocks.changes.selectedSection = "changelist:default";
  mocks.changes.selectedPaths = ["first.txt", "second.txt"];
  await openMenu();
  await click("commitTw.commitFiles");
  expect(mocks.changes.setChecked).toHaveBeenCalledWith(["first.txt", "second.txt"]);
  expect(mocks.changes.stage).not.toHaveBeenCalled();
  expect(mocks.focusCommitUi).toHaveBeenCalledOnce();
});

it("Commit Files… does not stage already-staged paths", async () => {
  mocks.dialog.mockResolvedValue({ paths: ["first.txt", "second.txt"] });
  await openMenu();
  await click("commitTw.commitFiles");
  expect(mocks.changes.stage).not.toHaveBeenCalled();
  expect(mocks.changes.add).not.toHaveBeenCalled();
  expect(mocks.focusCommitUi).toHaveBeenCalledOnce();
});

it("Commit Files… stops after navigation invalidates staging", async () => {
  const pending = deferred<void>();
  mocks.changes.stage.mockReturnValue(pending.promise);
  mocks.changes.selectedSection = "unstaged";
  mocks.changes.selectedPaths = ["first.txt"];
  await openMenu();
  await click("commitTw.commitFiles");
  mocks.ws.generation++;
  pending.resolve();
  await flushPromises();
  expect(mocks.focusCommitUi).not.toHaveBeenCalled();
});

it("Commit Files… uses only confirmed original paths still present after refresh", async () => {
  const answer = deferred<{ paths: string[] }>();
  mocks.dialog.mockReturnValue(answer.promise);
  mocks.changes.stagingMode = false;
  mocks.changes.selectedSection = "changelist:default";
  await openMenu();
  await click("commitTw.commitFiles");
  expect(mocks.dialog.mock.calls[0]?.[1]).toEqual({
    initialPaths: ["first.txt", "second.txt"],
    section: "changelist:default",
  });
  mocks.changes.selectedPaths = ["unrelated.txt"];
  mocks.changes.pathsForSection.mockReturnValue(["second.txt", "unrelated.txt"]);
  answer.resolve({ paths: ["first.txt", "second.txt", "unrelated.txt", "second.txt"] });
  await flushPromises();
  expect(mocks.changes.setChecked).toHaveBeenCalledExactlyOnceWith(["second.txt"]);
  expect(mocks.focusCommitUi).toHaveBeenCalledOnce();
});

it.each(["cancel", "empty", "navigation", "mode"])(
  "Commit Files… aborts without staging or focusing on %s",
  async (kind) => {
    const answer = deferred<{ paths: string[] } | null>();
    mocks.dialog.mockReturnValue(answer.promise);
    mocks.changes.selectedSection = "unstaged";
    await openMenu();
    await click("commitTw.commitFiles");
    if (kind === "navigation") mocks.ws.generation++;
    if (kind === "mode") mocks.changes.stagingMode = false;
    answer.resolve(kind === "cancel" ? null : { paths: kind === "empty" ? [] : ["second.txt"] });
    await flushPromises();
    expect(mocks.changes.stage).not.toHaveBeenCalled();
    expect(mocks.changes.add).not.toHaveBeenCalled();
    expect(mocks.changes.setChecked).not.toHaveBeenCalled();
    expect(mocks.focusCommitUi).not.toHaveBeenCalled();
  },
);

it("Commit Files… stages only the confirmed subset without clearing the existing index", async () => {
  mocks.changes.selectedSection = "unstaged";
  mocks.dialog.mockResolvedValue({ paths: ["second.txt"] });
  await openMenu();
  await click("commitTw.commitFiles");
  expect(mocks.changes.stage).toHaveBeenCalledExactlyOnceWith(["second.txt"]);
  expect(mocks.changes.unstage).not.toHaveBeenCalled();
  expect(mocks.focusCommitUi).toHaveBeenCalledOnce();
});
