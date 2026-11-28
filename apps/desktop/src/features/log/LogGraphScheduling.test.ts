import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, getActivePinia, setActivePinia } from "pinia";
import { nextTick, reactive, ref } from "vue";
import { useLogStore } from "@/stores/logStore";
import { useJobsStore } from "@/stores/jobsStore";
import { layoutCommitGraphIncremental } from "./graphLayout";
import CommitGraphCell from "./CommitGraphCell.vue";
import LogView from "./LogView.vue";
import VirtualList from "@/components/common/VirtualList.vue";

const mocks = vi.hoisted(() => ({
  ws: {} as any,
  settings: {} as any,
  scroll: vi.fn(),
  details: vi.fn(),
  locate: vi.fn(),
  query: vi.fn(),
}));
vi.mock("./graphLayout", async (original) => {
  const module = await original<typeof import("./graphLayout")>();
  return { ...module, layoutCommitGraphIncremental: vi.fn(module.layoutCommitGraphIncremental) };
});
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    logCommitDetails: mocks.details,
    logChangedFiles: async () => [],
    logLocate: mocks.locate,
    logQuery: mocks.query,
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
  mocks.details.mockReset().mockResolvedValue(null);
  mocks.locate.mockReset();
  mocks.query.mockReset();
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
      plugins: [getActivePinia()!],
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

it.each(["flat", "tree"] as const)(
  "refreshes author and first-parent navigation with the same SHA in %s mode",
  async (mode) => {
    const log = useLogStore();
    const rows = [commit("tip", ["left", "right"]), commit("right", ["base"]), commit("left", ["base"]), commit("base")];
    log.commits = rows;
    await mountView(mode);
    await renderFrame();
    const oldGraph = wrapper!.findAllComponents(CommitGraphCell).map(cell => cell.props("graph"));
    vi.mocked(log.load).mockRestore();
    const updated = rows.map(row => ({ ...row, parents: [...row.parents], refs: [...row.refs] }));
    updated[0]!.parents.reverse();
    updated[0]!.author = "After";
    mocks.query.mockResolvedValue({ commits: updated, nextOffset: 4, truncated: false });
    await log.load(true, true);
    await renderFrame();
    const tip = wrapper!.findAll('[role="option"]').find(row => row.text().includes("tip"))!;
    expect(tip.text()).toContain("After");
    if (mode === "flat") {
      const graphs = wrapper!.findAllComponents(CommitGraphCell).map(cell => cell.props("graph"));
      expect(graphs).not.toEqual(oldGraph);
    }
    await tip.trigger("keydown", { key: "ArrowLeft" });
    await renderFrame();
    expect(log.selectedSha).toBe("right");
    vi.mocked(layoutCommitGraphIncremental).mockClear();
    const current = log.commits;
    mocks.query.mockResolvedValue({ commits: structuredClone(updated), nextOffset: 4, truncated: false });
    await log.load(true, true);
    await renderFrame();
    expect(log.commits).toBe(current);
    expect(layoutCommitGraphIncremental).not.toHaveBeenCalled();
  },
);

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

it.each([
  ["flat", false],
  ["flat", true],
  ["tree", false],
  ["tree", true],
] as const)(
  "reveals a %s target before slow details settle (distant=%s)",
  async (mode, distant) => {
    const log = useLogStore();
    const target = distant ? "distant" : "root";
    mocks.locate.mockResolvedValue({ sha: target, offset: distant ? 10000 : 1 });
    mocks.query.mockResolvedValue({
      commits: [commit(target)],
      nextOffset: 10001,
      truncated: true,
    });
    let finish!: (value: null) => void;
    mocks.details.mockReturnValue(
      new Promise<null>((resolve) => {
        finish = resolve;
      }),
    );
    await mountView(mode);
    await renderFrame();
    log.goToInput = target;
    await wrapper!
      .get('input[placeholder="log.goToPlaceholder"]')
      .trigger("keydown", { key: "Enter" });
    await flushPromises();
    await renderFrame();
    expect(log.selectedSha).toBe(target);
    expect(log.detailsLoading).toBe(true);
    expect(log.locating).toBe(false);
    expect(
      wrapper!.get('input[placeholder="log.goToPlaceholder"]').attributes("disabled"),
    ).toBeUndefined();
    expect(mocks.scroll).toHaveBeenCalledOnce();
    expect(mocks.scroll.mock.lastCall![1]).toBe("center");
    expect(useJobsStore().running.map((job) => job.title)).toEqual(["log.loadingDetails"]);
    finish(null);
    await flushPromises();
    expect(useJobsStore().count).toBe(0);
  },
);

it("reveals a located commit even when its details fail, keeping the local error", async () => {
  const log = useLogStore();
  mocks.locate.mockResolvedValue({ sha: "root", offset: 1 });
  mocks.details.mockRejectedValue(new Error("details unavailable"));
  await mountView("flat");
  await renderFrame();
  log.goToInput = "root";
  await wrapper!
    .get('input[placeholder="log.goToPlaceholder"]')
    .trigger("keydown", { key: "Enter" });
  await flushPromises();
  await renderFrame();
  expect(log.selectedSha).toBe("root");
  expect(log.detailsError).toBe("details unavailable");
  expect(mocks.scroll).toHaveBeenCalledExactlyOnceWith(1, "center");
  expect(useJobsStore().count).toBe(0);
});

it("reads a previously unloaded parent once and scrolls while details remain pending", async () => {
  const log = useLogStore();
  log.commits = [commit("child", ["parent"])];
  mocks.locate.mockResolvedValue({ sha: "parent", offset: 100 });
  mocks.query.mockResolvedValue({ commits: [commit("parent")], nextOffset: 101, truncated: false });
  let finish!: (value: null) => void;
  mocks.details.mockReturnValue(
    new Promise<null>((resolve) => {
      finish = resolve;
    }),
  );
  await mountView("flat");
  await renderFrame();
  await wrapper!.get('[role="option"]').trigger("keydown", { key: "ArrowLeft" });
  await flushPromises();
  await renderFrame();
  expect(log.selectedSha).toBe("parent");
  expect(mocks.scroll).toHaveBeenCalledOnce();
  expect(mocks.details).toHaveBeenCalledOnce();
  finish(null);
  await flushPromises();
  await renderFrame();
  expect(mocks.details).toHaveBeenCalledOnce();
});

it.each([false, true])(
  "keeps a navigation task until locate settles (failure=%s)",
  async (failure) => {
    const log = useLogStore();
    let finish!: (value: { sha: string; offset: number | null }) => void;
    let fail!: (reason: Error) => void;
    mocks.locate.mockReturnValue(
      new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
    );
    const request = log.goToHashOrRef("hidden").catch((error: Error) => error);
    await flushPromises();
    expect(log.locating).toBe(true);
    expect(useJobsStore().running).toEqual([
      expect.objectContaining({ title: "log.locating · hidden", message: "A" }),
    ]);
    if (failure) fail(new Error("cannot resolve revision"));
    else finish({ sha: "hidden", offset: null });
    const result = await request;
    expect(log.locating).toBe(false);
    expect(useJobsStore().count).toBe(0);
    if (failure) expect(result).toBeInstanceOf(Error);
    else expect(log.navigationMiss).toBe("hidden");
  },
);

it("keeps the locate task through the target page and ends it when the page fails", async () => {
  const log = useLogStore();
  mocks.locate.mockResolvedValue({ sha: "far", offset: 10000 });
  let fail!: (error: Error) => void;
  mocks.query.mockReturnValue(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  const request = log.goToHashOrRef("far").catch((error: Error) => error);
  await flushPromises();
  expect(log.locating).toBe(true);
  expect(useJobsStore().count).toBe(1);
  fail(new Error("page unavailable"));
  expect(await request).toBeInstanceOf(Error);
  expect(log.locating).toBe(false);
  expect(useJobsStore().count).toBe(0);
  expect(mocks.details).not.toHaveBeenCalled();
});

it.each(["selection", "repository", "dispose"])(
  "does not publish late detail failure after %s invalidates the located target",
  async (reason) => {
    const log = useLogStore();
    mocks.locate.mockResolvedValue({ sha: "root", offset: 1 });
    let fail!: (error: Error) => void;
    mocks.details.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    const request = log.goToHashOrRef("root");
    await flushPromises();
    expect(log.locating).toBe(false);
    expect(await request).toBe("root");
    if (reason === "selection") await log.select("tip");
    else if (reason === "repository") mocks.ws.repoPath = "B";
    else log.$dispose();
    fail(new Error("obsolete detail failure"));
    await flushPromises();
    expect(log.detailsError).toBeNull();
    expect(log.detailsLoading).toBe(false);
    expect(useJobsStore().count).toBe(0);
    if (reason === "selection") expect(log.selectedSha).toBe("tip");
  },
);

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

it.each(["pending", "populated"])(
  "clears old tree rows before the first frame of a %s repository",
  async (state) => {
    await mountView("tree");
    await renderFrame();
    const log = useLogStore();
    mocks.ws.repoPath = "B";
    mocks.ws.repoId = "B";
    if (state === "pending") log.loading = true;
    else log.commits = [commit("repo-b")];
    await nextTick();
    expect(wrapper!.findAll('[role="option"]')).toHaveLength(0);
    await renderFrame();
    expect(wrapper!.findAll('[role="option"]').map((row) => row.text())).toEqual(
      state === "pending" ? [] : [expect.stringContaining("repo-b")],
    );
  },
);

it("does not dispatch an old visible tree row into the newly populated repository", async () => {
  await mountView("tree");
  await renderFrame();
  mocks.ws.repoPath = "B";
  mocks.ws.repoId = "B";
  useLogStore().commits = [commit("repo-b")];
  await nextTick();
  const obsolete = wrapper!.findAll('[role="option"]').find((row) => row.text().includes("tip"));
  if (obsolete) await obsolete.trigger("click");
  await flushPromises();
  expect(mocks.details).not.toHaveBeenCalled();
  expect(useLogStore().selectedSha).not.toBe("tip");
});

it("keeps the same-repository tree presentation while an ordinary refresh frame is queued", async () => {
  await mountView("tree");
  await renderFrame();
  const displayed = wrapper!.findAll('[role="option"]').map((row) => row.text());
  useLogStore().commits = [commit("new-tip", ["root"], ["main"]), commit("root")];
  await nextTick();
  expect(wrapper!.findAll('[role="option"]').map((row) => row.text())).toEqual(displayed);
  await renderFrame();
  expect(wrapper!.findAll('[role="option"]')[0]!.text()).toContain("new-tip");
});

it("discards pending tree rows across rapid repository changes and selects only the final rows", async () => {
  await mountView("tree");
  await renderFrame();
  useLogStore().commits = [commit("pending-a")];
  await nextTick();
  mocks.ws.repoPath = "B";
  mocks.ws.repoId = "B";
  useLogStore().commits = [commit("pending-b")];
  await nextTick();
  expect(wrapper!.findAll('[role="option"]')).toHaveLength(0);
  mocks.ws.repoPath = "C";
  mocks.ws.repoId = "C";
  useLogStore().commits = [commit("final-c")];
  await nextTick();
  expect(wrapper!.findAll('[role="option"]')).toHaveLength(0);
  await renderFrame();
  const rows = wrapper!.findAll('[role="option"]');
  expect(rows).toHaveLength(1);
  expect(rows[0]!.text()).toContain("final-c");
  await rows[0]!.trigger("click");
  expect(mocks.details).toHaveBeenCalledExactlyOnceWith({ path: "C", sha: "final-c" });
});

it("invalidates tree rows on repository identity changes and schedules their replacement", async () => {
  await mountView("tree");
  await renderFrame();
  // A repository identity transition must invalidate even when the path is unchanged.
  mocks.ws.repoId = "new-id";
  await nextTick();
  expect(wrapper!.findAll('[role="option"]')).toHaveLength(0);
  await renderFrame();
  expect(wrapper!.findAll('[role="option"]')).toHaveLength(2);
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
