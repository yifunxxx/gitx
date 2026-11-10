import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { reactive, ref } from "vue";
import { useLogStore } from "@/stores/logStore";
import LogView from "./LogView.vue";

const m = vi.hoisted(() => ({
  ws: {} as any,
  backend: { logCommitDetails: vi.fn(), logChangedFiles: vi.fn() },
  compare: {
    compareVersions: vi.fn(),
    compareWithLocal: vi.fn(),
    showCombined: vi.fn(),
    tabs: [] as any[],
  },
  rewrite: {
    busy: false,
    cherryPick: vi.fn(),
    revert: vi.fn(),
    drop: vi.fn(),
    uncommit: vi.fn(),
    extractChanges: vi.fn(),
  },
  layout: { bottomMaximized: true, activeEditorKind: "log" },
  history: vi.fn(),
  repoAtRev: vi.fn(),
  diff: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
  open: vi.fn(),
  toast: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m.backend }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => m.ws }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({ remotes: [] }) }));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => m.compare }));
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: () => ({ openFileHistory: m.history }),
}));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => ({ open: m.repoAtRev }) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({ openRevDiff: m.diff }) }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => m.layout }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => m.rewrite }));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: m.confirm, promptDialog: m.prompt }));
vi.mock("@/composables/useDialog", () => ({ openDialog: m.open }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (k: string) => k } } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (k: string) => k, locale: ref("en") }) }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const commit = (sha: string, parents: string[] = []) => ({
  sha,
  shortSha: sha,
  parents,
  refs: sha === "a" ? ["HEAD -> main"] : [],
  subject: sha,
  author: "QA",
  authorEmail: "qa@example.invalid",
  authorTime: 1,
  graph: { lane: 0, color: 0, edges: [] },
});
let wrapper: ReturnType<typeof shallowMount>;
beforeEach(async () => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  m.ws = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    generation: 0,
    navigationToken() {
      return this.generation;
    },
  });
  m.rewrite.busy = false;
  m.layout.bottomMaximized = true;
  m.layout.activeEditorKind = "log";
  m.compare.tabs = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: m.copy },
  });
  const log = useLogStore();
  vi.spyOn(log, "load").mockResolvedValue();
  log.commits = [commit("a", ["b"]), commit("b", ["root"]), commit("root")];
  m.backend.logCommitDetails.mockImplementation(async ({ sha }) => ({ ...commit(sha), body: "" }));
  m.backend.logChangedFiles.mockResolvedValue([
    { path: "new.txt", origPath: "old.txt", status: "R" },
  ]);
  await log.select("a");
  wrapper = shallowMount(LogView, {
    global: {
      stubs: {
        PathTreeList: false,
        Splitpanes: { template: "<div><slot /></div>" },
        Pane: { template: "<div><slot /></div>" },
        VirtualList: {
          props: ["items"],
          template: '<div><slot v-for="(item,index) in items" :item="item" :index="index" /></div>',
        },
        ContextMenuSurface: {
          props: ["open"],
          template: '<div v-if="open" role="menu" @click.stop><slot /></div>',
        },
        Tip: { template: "<span><slot /></span>" },
        Button: { template: "<button><slot /></button>" },
      },
    },
  });
  await flushPromises();
});
afterEach(() => wrapper.unmount());
const menu = (label: string) =>
  wrapper.findAll('[role="menuitem"]').find((b) => b.text() === label)!;
const context = async (index = 0) =>
  wrapper.findAll('[role="option"]')[index]!.trigger("contextmenu", { clientX: 100, clientY: 100 });

it.each(["keydown", "dblclick"])(
  "opens the focused commit through %s without an open menu",
  async (event) => {
    const exact = { id: "root-compare" };
    m.compare.compareVersions.mockResolvedValueOnce(exact);
    await wrapper.findAll('[role="option"]')[2]!.trigger(event, { key: "Enter" });
    await flushPromises();
    expect(m.compare.compareVersions).toHaveBeenCalledExactlyOnceWith("EMPTY", "root");
    expect(m.compare.showCombined).toHaveBeenCalledExactlyOnceWith(exact);
  },
);
it("ignores repeated and modified Enter on commit rows", async () => {
  const row = wrapper.findAll('[role="option"]')[0]!;
  for (const modifiers of [
    { repeat: true },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
    { isComposing: true },
  ])
    await row.trigger("keydown", { key: "Enter", ...modifiers });
  expect(m.compare.compareVersions).not.toHaveBeenCalled();
});

it("opens the real tree row's copied file metadata from right click and double click", async () => {
  const row = wrapper.findComponent({ name: "PathTreeList" }).get(".cursor-pointer");
  await row.trigger("contextmenu", { clientX: 10, clientY: 20 });
  expect(menu("actions.showDiff").exists()).toBe(true);
  await menu("actions.showDiff").trigger("click");
  expect(m.diff).toHaveBeenCalledExactlyOnceWith("new.txt", "b", "a", "old.txt");
  m.diff.mockClear();
  await row.trigger("dblclick");
  expect(m.diff).toHaveBeenCalledExactlyOnceWith("new.txt", "b", "a", "old.txt");
});

it("ignores an old file-list callback after selecting a different commit with the same path", async () => {
  const tree = wrapper.findComponent({ name: "PathTreeList" });
  const oldOpen = tree.vm.$.vnode.props!.onOpen;
  const oldContext = tree.vm.$.vnode.props!.onContext;
  const file = { ...useLogStore().changedFiles[0]! };
  await useLogStore().select("b");
  await flushPromises();
  await oldOpen(file);
  oldContext({ file, x: 10, y: 20 });
  await flushPromises();
  expect(m.diff).not.toHaveBeenCalled();
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
});

it("does not retarget a lazy dialog when selection changes during imports", async () => {
  await context();
  const click = menu("actions.reword").trigger("click");
  void useLogStore().select("b");
  await click;
  await vi.waitFor(() => expect(m.open).toHaveBeenCalled());
  expect(m.open.mock.lastCall![1]).toEqual({ sha: "a" });
});

it.each(["navigation", "same-path", "identity", "unmount"])(
  "invalidates a confirmed drop after %s",
  async (change) => {
    const answer = deferred<boolean>();
    m.confirm.mockReturnValue(answer.promise);
    await context();
    await menu("actions.dropCommits").trigger("click");
    if (change === "navigation") {
      m.ws.repoPath = "B";
      m.ws.repoPath = "A";
    } else if (change === "same-path") ++m.ws.generation;
    else if (change === "identity") m.ws.repoId = "new-A";
    else wrapper.unmount();
    answer.resolve(true);
    await flushPromises();
    expect(m.rewrite.drop).not.toHaveBeenCalled();
  },
);

it("preserves an accepted multi-selection while confirmation is open", async () => {
  const answer = deferred<boolean>();
  m.confirm.mockReturnValue(answer.promise);
  await useLogStore().select("b", true);
  await context();
  await menu("actions.dropCommits").trigger("click");
  await useLogStore().select("root");
  answer.resolve(true);
  await flushPromises();
  expect(m.rewrite.drop).toHaveBeenCalledExactlyOnceWith(["a", "b"]);
});

it("dismisses a menu on selection change and ignores its detached command", async () => {
  await context();
  const button = menu("actions.cherryPick");
  await useLogStore().select("b");
  await flushPromises();
  expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  await button.trigger("click");
  expect(m.rewrite.cherryPick).not.toHaveBeenCalled();
});

it("uses the exact new comparison tab and EMPTY for the root commit", async () => {
  const exact = { id: "root-comparison", left: "EMPTY", right: "root" };
  m.compare.tabs = [{ id: "other", left: "root", right: "WORKTREE" }, exact];
  m.compare.compareVersions.mockResolvedValue(exact);
  await context(2);
  await menu("history.showAllChanges").trigger("click");
  await flushPromises();
  expect(m.compare.compareVersions).toHaveBeenCalledExactlyOnceWith("EMPTY", "root");
  expect(m.compare.showCombined).toHaveBeenCalledExactlyOnceWith(exact);
});

it("offers a file menu before opening history, and preserves rename paths", async () => {
  const file = useLogStore().changedFiles[0]!;
  wrapper.findComponent({ name: "PathTreeList" }).vm.$emit("context", { file, x: 1, y: 2 });
  await flushPromises();
  expect(m.history).not.toHaveBeenCalled();
  await menu("actions.showDiff").trigger("click");
  expect(m.diff).toHaveBeenCalledExactlyOnceWith("new.txt", "b", "a", "old.txt");
});

it("does not change a new repository's layout after an old compare completes", async () => {
  const result = deferred<void>();
  m.compare.compareVersions.mockReturnValue(result.promise);
  await useLogStore().select("b", true);
  await context();
  await menu("history.compareVersions").trigger("click");
  ++m.ws.generation;
  m.layout.bottomMaximized = true;
  result.resolve();
  await flushPromises();
  expect(m.layout.bottomMaximized).toBe(true);
});

it("reports clipboard success only after the captured revision is written", async () => {
  const result = deferred<void>();
  m.copy.mockReturnValue(result.promise);
  await context();
  await menu("log.copyRevision").trigger("click");
  expect(m.toast).not.toHaveBeenCalled();
  await useLogStore().select("b");
  result.resolve();
  await flushPromises();
  expect(m.copy).toHaveBeenCalledExactlyOnceWith("a");
  expect(m.toast).toHaveBeenCalledWith({ title: "log.copiedRevision" });
});

it("disables single-commit operations for multi-selection and uncommit away from HEAD", async () => {
  await useLogStore().select("b", true);
  await context();
  expect(menu("actions.reword").attributes("disabled")).toBeDefined();
  expect(menu("history.compareVersions").attributes("disabled")).toBeUndefined();
  await context(2);
  expect(menu("actions.uncommit").attributes("disabled")).toBeDefined();
  expect(menu("actions.squash").attributes("disabled")).toBeDefined();
});

it("copies the right-clicked revision immediately while its details are pending", async () => {
  const response = deferred<any>();
  m.backend.logCommitDetails.mockReturnValueOnce(response.promise);
  await context(1);
  expect(menu("actions.reword").attributes("disabled")).toBeUndefined();
  await menu("log.copyRevision").trigger("click");
  await flushPromises();
  expect(m.copy).toHaveBeenCalledExactlyOnceWith("b");
  response.resolve({ ...commit("b"), body: "" });
  await flushPromises();
});

it("does not activate a replacement menu from a detached old button", async () => {
  await context();
  const old = menu("actions.cherryPick");
  await context(1);
  await old.trigger("click");
  expect(m.rewrite.cherryPick).not.toHaveBeenCalled();
  await menu("actions.cherryPick").trigger("click");
  expect(m.rewrite.cherryPick).toHaveBeenCalledExactlyOnceWith({ shas: ["b"] });
});

it.each([false, true])(
  "does not drop after cancelled confirmation or a new busy operation (%s)",
  async (busy) => {
    const answer = deferred<boolean>();
    m.confirm.mockReturnValueOnce(answer.promise);
    await context();
    await menu("actions.dropCommits").trigger("click");
    m.rewrite.busy = busy;
    answer.resolve(busy);
    await flushPromises();
    expect(m.rewrite.drop).not.toHaveBeenCalled();
  },
);

it.each(["same-path", "unmount"])("does not open a lazy dialog after %s", async (change) => {
  await context();
  const pending = menu("actions.reset").trigger("click");
  if (change === "same-path") ++m.ws.generation;
  else wrapper.unmount();
  await pending;
  await flushPromises();
  expect(m.open).not.toHaveBeenCalled();
});

it("does not continue a combined comparison after navigation", async () => {
  const response = deferred<any>();
  m.compare.compareVersions.mockReturnValueOnce(response.promise);
  await context();
  await menu("history.showAllChanges").trigger("click");
  ++m.ws.generation;
  response.resolve({ id: "old" });
  await flushPromises();
  expect(m.compare.showCombined).not.toHaveBeenCalled();
});

it("shows current clipboard failures and suppresses failures from old repositories", async () => {
  m.copy.mockRejectedValueOnce(new Error("clipboard unavailable"));
  await context();
  await menu("log.copyRevision").trigger("click");
  await flushPromises();
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({
    title: "log.failed",
    description: "clipboard unavailable",
  });
  m.toast.mockClear();
  const response = deferred<void>();
  m.copy.mockReturnValueOnce(response.promise);
  await context();
  await menu("log.copyRevision").trigger("click");
  ++m.ws.generation;
  response.reject(new Error("old failure"));
  await flushPromises();
  expect(m.toast).not.toHaveBeenCalled();
});

it("invalidates a file menu on selection change without opening the wrong path", async () => {
  const tree = wrapper.findComponent({ name: "PathTreeList" });
  tree.vm.$emit("context", { file: useLogStore().changedFiles[0], x: 1, y: 2 });
  await flushPromises();
  const old = menu("history.showHistory");
  tree.vm.$emit("select", { path: "other", origPath: null, status: "M" });
  await flushPromises();
  await old.trigger("click");
  expect(m.history).not.toHaveBeenCalled();
});

it("opens a root file against EMPTY and does not steal layout after completion", async () => {
  await useLogStore().select("root");
  const response = deferred<void>();
  m.diff.mockReturnValueOnce(response.promise);
  wrapper.findComponent({ name: "PathTreeList" }).vm.$emit("open", useLogStore().changedFiles[0]);
  await flushPromises();
  expect(m.diff).toHaveBeenCalledExactlyOnceWith("new.txt", "EMPTY", "root", "old.txt");
  m.layout.bottomMaximized = true;
  m.layout.activeEditorKind = "history";
  response.resolve();
  await flushPromises();
  expect(m.layout).toMatchObject({ bottomMaximized: true, activeEditorKind: "history" });
});

it("freezes extraction paths and commit before the message prompt", async () => {
  const answer = deferred<string>();
  m.prompt.mockReturnValueOnce(answer.promise);
  await context();
  await menu("actions.extractSelected").trigger("click");
  await useLogStore().select("b");
  useLogStore().changedFiles = [];
  answer.resolve("Extract exactly this");
  await flushPromises();
  expect(m.rewrite.extractChanges).toHaveBeenCalledExactlyOnceWith(
    "a",
    ["new.txt"],
    "Extract exactly this",
  );
});

it("discards extraction after reopening the same path", async () => {
  const answer = deferred<string>();
  m.prompt.mockReturnValueOnce(answer.promise);
  await context();
  await menu("actions.extractSelected").trigger("click");
  ++m.ws.generation;
  answer.resolve("stale");
  await flushPromises();
  expect(m.rewrite.extractChanges).not.toHaveBeenCalled();
});
