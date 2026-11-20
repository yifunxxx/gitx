import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive, ref } from "vue";
import { useLogStore } from "@/stores/logStore";
import { layoutCommitGraphIncremental } from "./graphLayout";
import CommitGraphCell from "./CommitGraphCell.vue";
import LogView from "./LogView.vue";

const mocks = vi.hoisted(() => ({ ws: {} as any, settings: {} as any }));
vi.mock("./graphLayout", async (original) => {
  const module = await original<typeof import("./graphLayout")>();
  return { ...module, layoutCommitGraphIncremental: vi.fn(module.layoutCommitGraphIncremental) };
});
vi.mock("@/lib/backend", () => ({ getBackend: () => ({}) }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({ remotes: [] }) }));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => ({}) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => ({}) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({}) }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({}) }));
vi.mock("@/stores/rewriteStore", () => ({
  useRewriteStore: () => ({ busy: false, repositoryToken: () => 1 }),
}));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: vi.fn(), promptDialog: vi.fn() }));
vi.mock("@/composables/useDialog", () => ({ openDialog: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: ref("en") }) }));

const commit = (sha: string, parents: string[] = [], refs: string[] = []) => ({
  sha,
  shortSha: sha,
  parents,
  refs,
  subject: sha,
  author: "QA",
  authorEmail: "qa@example.invalid",
  authorTime: 1,
  graph: { lane: 0, color: 0, edges: [] },
});
let wrapper: ReturnType<typeof shallowMount> | undefined;
let frames: Map<number, FrameRequestCallback>;
let nextFrameId = 0;

beforeEach(() => {
  vi.clearAllMocks();
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrameId, callback);
    return nextFrameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  setActivePinia(createPinia());
  mocks.ws = reactive({ repoPath: "A", repoId: "A", isRepo: true, navigationToken: () => 1 });
  mocks.settings = reactive({ settings: { git: { logListMode: "tree" } }, save: vi.fn() });
  const log = useLogStore();
  vi.spyOn(log, "load").mockResolvedValue();
  log.commits = [commit("tip", ["root"], ["main"]), commit("root")];
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.unstubAllGlobals();
});

async function mountView(mode: "tree" | "flat" = "tree") {
  mocks.settings.settings.git.logListMode = mode;
  wrapper = shallowMount(LogView, {
    global: {
      stubs: {
        Splitpanes: { template: "<div><slot /></div>" },
        Pane: { template: "<div><slot /></div>" },
        Tip: { template: "<span><slot /></span>" },
        Button: { template: "<button><slot /></button>" },
        VirtualList: {
          props: ["items"],
          template: '<div><slot v-for="(item, index) in items" :item="item" :index="index" /></div>',
        },
      },
    },
  });
  await flushPromises();
}
async function renderFrame() {
  await nextTick();
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(0));
  await flushPromises();
}

it("does not build a hidden graph when mounting the tree view", async () => {
  await mountView();
  await renderFrame();
  expect(wrapper!.findAll('[role="option"]')).toHaveLength(2);
  expect(wrapper!.findAllComponents(CommitGraphCell)).toHaveLength(0);
  expect(layoutCommitGraphIncremental).not.toHaveBeenCalled();
});

it("defers graph changes while tree rows receive refreshed commits and filters", async () => {
  await mountView();
  await renderFrame();
  vi.mocked(layoutCommitGraphIncremental).mockClear();
  const log = useLogStore();
  log.commits = [commit("new-tip", ["root"], ["renamed"]), commit("root")];
  log.filters.firstParent = true;
  log.filters.text = "matching";
  await renderFrame();
  expect(wrapper!.findAll('[role="option"]').map((row) => row.text())).toContainEqual(
    expect.stringContaining("new-tip"),
  );
  expect(layoutCommitGraphIncremental).not.toHaveBeenCalled();
});

it("builds the latest graph and filter options when switching from tree to flat", async () => {
  await mountView();
  await renderFrame();
  const log = useLogStore();
  log.commits = [commit("new-tip", ["root"], ["renamed"]), commit("root")];
  log.filters.firstParent = true;
  log.filters.text = "matching";
  await renderFrame();
  vi.mocked(layoutCommitGraphIncremental).mockClear();
  mocks.settings.settings.git.logListMode = "flat";
  await nextTick();
  expect(wrapper!.findAllComponents(CommitGraphCell)).toHaveLength(0);
  await renderFrame();
  expect(layoutCommitGraphIncremental).toHaveBeenCalledExactlyOnceWith(
    log.commits,
    { filtered: true, firstParent: true },
    null,
  );
  const cells = wrapper!.findAllComponents(CommitGraphCell);
  expect(cells).toHaveLength(2);
  expect(cells[0]!.props("nodeLabel")).toBe("renamed");
});

it("cancels a pending flat graph when the user switches to tree before the frame", async () => {
  await mountView("flat");
  mocks.settings.settings.git.logListMode = "tree";
  await renderFrame();
  expect(layoutCommitGraphIncremental).not.toHaveBeenCalled();
  expect(wrapper!.findAllComponents(CommitGraphCell)).toHaveLength(0);
  expect(wrapper!.findAll('[role="option"]')).toHaveLength(2);
});

it("clears the previous graph while hidden and never flashes it on returning to flat", async () => {
  await mountView("flat");
  await renderFrame();
  expect(wrapper!.findAllComponents(CommitGraphCell)[0]!.props("nodeLabel")).toBe("main");
  mocks.settings.settings.git.logListMode = "tree";
  await renderFrame();
  useLogStore().commits = [commit("other", [], ["different-history"])];
  await renderFrame();
  mocks.settings.settings.git.logListMode = "flat";
  await nextTick();
  expect(wrapper!.findAllComponents(CommitGraphCell)).toHaveLength(0);
  await renderFrame();
  expect(wrapper!.findAllComponents(CommitGraphCell)[0]!.props("nodeLabel")).toBe("different-history");
});

it("keeps incremental append reuse while flat and coalesces pending updates", async () => {
  const log = useLogStore();
  log.commits = [commit("tip", ["root"], ["main"])];
  await mountView("flat");
  await renderFrame();
  const firstGraph = wrapper!.findAllComponents(CommitGraphCell)[0]!.props("graph");
  vi.mocked(layoutCommitGraphIncremental).mockClear();
  log.commits = [...log.commits, commit("root", ["older"])];
  await nextTick();
  log.commits = [...log.commits, commit("older")];
  await renderFrame();
  expect(layoutCommitGraphIncremental).toHaveBeenCalledTimes(1);
  expect(wrapper!.findAllComponents(CommitGraphCell)).toHaveLength(3);
  expect(wrapper!.findAllComponents(CommitGraphCell)[0]!.props("graph")).toBe(firstGraph);
});
