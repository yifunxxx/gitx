import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive, ref } from "vue";
import { useLogStore } from "@/stores/logStore";
import { layoutCommitGraphIncremental } from "./graphLayout";
import CommitGraphCell from "./CommitGraphCell.vue";
import LogView from "./LogView.vue";
import VirtualList from "@/components/common/VirtualList.vue";

const mocks = vi.hoisted(() => ({ ws: {} as any, settings: {} as any, scroll: vi.fn() }));
vi.mock("./graphLayout", async (original) => {
  const module = await original<typeof import("./graphLayout")>();
  return { ...module, layoutCommitGraphIncremental: vi.fn(module.layoutCommitGraphIncremental) };
});
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    logCommitDetails: async () => null,
    logChangedFiles: async () => [],
  }),
}));
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

async function mountView(mode: "tree" | "flat" = "tree", realList = false) {
  mocks.settings.settings.git.logListMode = mode;
  wrapper = shallowMount(LogView, {
    global: {
      stubs: {
        Splitpanes: { template: "<div><slot /></div>" },
        Pane: { template: "<div><slot /></div>" },
        Tip: { template: "<span><slot /></span>" },
        Button: { template: "<button><slot /></button>" },
        VirtualList: realList
          ? false
          : {
              props: ["items"],
              methods: { scrollToIndex: mocks.scroll },
              template:
                '<div><slot v-for="(item, index) in items" :item="item" :index="index" /></div>',
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
  expect(wrapper!.findAllComponents(CommitGraphCell)[0]!.props("nodeLabel")).toBe(
    "different-history",
  );
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

function expectCoherentGraphRows() {
  for (const row of wrapper!.findAll('[role="option"]')) {
    const cell = row.findComponent(CommitGraphCell);
    if (cell.exists()) expect(row.text()).toContain(cell.props("nodeLabel"));
  }
}

it.each(["prepend", "reorder", "replace"])(
  "never pairs new commit text with old positional graphs while a %s layout is pending",
  async (change) => {
    const log = useLogStore();
    log.commits = [commit("left", ["base"]), commit("right", ["base"]), commit("base")];
    await mountView("flat");
    await renderFrame();
    expectCoherentGraphRows();
    const rendered = wrapper!.findAll('[role="option"]').map((row) => row.text());
    const old = log.commits;
    log.commits =
      change === "prepend"
        ? [commit("new-tip", ["left", "right"]), ...old]
        : change === "reorder"
          ? [old[1]!, old[0]!, old[2]!]
          : [commit("other-tip", ["other-root"]), commit("other-root")];
    await nextTick();
    expectCoherentGraphRows();
    expect(wrapper!.findAll('[role="option"]').map((row) => row.text())).toEqual(rendered);
    await renderFrame();
    expectCoherentGraphRows();
    expect(wrapper!.findAll('[role="option"]')).toHaveLength(log.commits.length);
    expect(wrapper!.findAllComponents(CommitGraphCell)).toHaveLength(log.commits.length);
  },
);

it("keeps new appended rows out until their graphs are ready and reuses prior graph objects", async () => {
  const log = useLogStore();
  log.commits = [commit("tip", ["root"])];
  await mountView("flat");
  await renderFrame();
  const graph = wrapper!.findComponent(CommitGraphCell).props("graph");
  log.commits = [...log.commits, commit("root")];
  await nextTick();
  expect(wrapper!.findAll('[role="option"]')).toHaveLength(1);
  await renderFrame();
  expect(wrapper!.findAllComponents(CommitGraphCell)).toHaveLength(2);
  expect(wrapper!.findComponent(CommitGraphCell).props("graph")).toBe(graph);
});

it("keeps selected-node panning tied to the displayed graph during reordering", async () => {
  const log = useLogStore();
  log.commits = Array.from({ length: 40 }, (_, i) => commit(`side-${i}`, [`root-${i}`]));
  await mountView("flat");
  await renderFrame();
  log.selectedSha = "side-39";
  await nextTick();
  const offset = () => Number(wrapper!.get<HTMLInputElement>('input[type="range"]').element.value);
  const before = offset();
  expect(before).toBeGreaterThan(0);
  log.commits = [log.commits[39]!, ...log.commits.slice(0, 39)];
  await nextTick();
  expect(offset()).toBe(before);
  await renderFrame();
  expect(offset()).toBeLessThan(before);
});

it("uses the displayed order for Shift ranges and keyboard navigation while layout is queued", async () => {
  const log = useLogStore();
  log.commits = [commit("a"), commit("b"), commit("c")];
  await mountView("flat");
  await renderFrame();
  await log.select("a");
  const original = log.commits;
  log.commits = [original[1]!, original[2]!, original[0]!];
  await nextTick();
  const rows = wrapper!.findAll('[role="option"]');
  await rows[2]!.trigger("click", { shiftKey: true });
  expect(log.selectedShas).toEqual(["a", "b", "c"]);
  await log.select("a");
  await rows[0]!.trigger("keydown", { key: "ArrowDown" });
  expect(log.selectedSha).toBe("b");
  expect(mocks.scroll).not.toHaveBeenCalled();
  await renderFrame();
  expect(mocks.scroll).toHaveBeenCalledExactlyOnceWith(0);
});

async function jumpToReplacement() {
  const log = useLogStore();
  vi.spyOn(log, "goToHashOrRef").mockImplementation(async () => {
    log.commits = [commit("new-top", ["target"]), commit("target")];
    log.selectedSha = "target";
    log.selectedShas = ["target"];
    return "target";
  });
  await wrapper!
    .get('input[placeholder="log.goToPlaceholder"]')
    .trigger("keydown", { key: "Enter" });
  await flushPromises();
}

it("waits for the flat graph and text snapshot before revealing a located commit", async () => {
  await mountView("flat");
  await renderFrame();
  await jumpToReplacement();
  expect(mocks.scroll).not.toHaveBeenCalled();
  await renderFrame();
  expect(mocks.scroll).toHaveBeenCalledExactlyOnceWith(1, "center");
  expectCoherentGraphRows();
});

it.each(["unmount", "repository", "selection"])(
  "does not reveal an obsolete flat target after %s invalidates it",
  async (reason) => {
    await mountView("flat");
    await renderFrame();
    await jumpToReplacement();
    if (reason === "unmount") {
      wrapper!.unmount();
      wrapper = undefined;
    } else if (reason === "repository") {
      mocks.ws.repoPath = "B";
      mocks.ws.repoId = "B";
    } else await useLogStore().select("new-top");
    await renderFrame();
    expect(mocks.scroll).not.toHaveBeenCalled();
    if (reason === "unmount") expect(frames.size).toBe(0);
  },
);

it("never carries the previous repository presentation into a newly populated repository", async () => {
  await mountView("flat");
  await renderFrame();
  mocks.ws.repoPath = "B";
  mocks.ws.repoId = "B";
  useLogStore().commits = [commit("repo-b")];
  await nextTick();
  expect(wrapper!.findAll('[role="option"]')).toHaveLength(0);
  await renderFrame();
  expect(wrapper!.findAll('[role="option"]')).toHaveLength(1);
  expect(wrapper!.findComponent(CommitGraphCell).props("nodeLabel")).toBe("repo-b");
});

it("preserves the real virtual list's anchor and coherent recycled rows across a prepend", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const log = useLogStore();
  log.commits = Array.from({ length: 200 }, (_, i) =>
    commit(`commit-${i}`, i < 199 ? [`commit-${i + 1}`] : []),
  );
  await mountView("flat", true);
  await renderFrame();
  const list = wrapper!.findComponent(VirtualList);
  const port = list.get("div.overflow-auto");
  const el = port.element as HTMLElement;
  el.scrollTop = 70 * 22;
  await port.trigger("scroll");
  await renderFrame();
  const before = wrapper!.findAll('[role="option"]').map((row) => row.text());
  log.commits = [commit("prepended", ["commit-0"]), ...log.commits];
  await nextTick();
  expect(wrapper!.findAll('[role="option"]').map((row) => row.text())).toEqual(before);
  expectCoherentGraphRows();
  await renderFrame();
  expect(el.scrollTop).toBe(71 * 22);
  expectCoherentGraphRows();
  expect(wrapper!.findAll('[role="option"]').length).toBeLessThan(60);
});
