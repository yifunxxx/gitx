import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, getActivePinia, setActivePinia } from "pinia";
import { nextTick, reactive, ref } from "vue";
import { useLogStore } from "@/stores/logStore";
import { useJobsStore } from "@/stores/jobsStore";
import LogView from "./LogView.vue";

const mocks = vi.hoisted(() => ({
  backend: {
    logQuery: vi.fn(),
    logIndexStatus: vi.fn(),
    logCommitDetails: vi.fn(),
    logChangedFiles: vi.fn(),
  },
  ws: {} as any,
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({ settings: { git: { logListMode: "flat" } } }),
}));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({ remotes: [] }) }));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => ({}) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => ({}) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({}) }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({}) }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => ({}) }));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: vi.fn(), promptDialog: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: ref("en") }) }));

const commit = (sha: string) => ({
  sha,
  shortSha: sha,
  parents: [],
  refs: [],
  subject: sha,
  author: "QA",
  authorEmail: "qa@example.invalid",
  authorTime: 1,
  graph: { lane: 0, edges: [], color: 0 },
});
const page = (sha?: string) => ({
  commits: sha ? [commit(sha)] : [],
  truncated: false,
  nextOffset: sha ? 1 : 0,
});
function deferred() {
  let resolve!: (value: ReturnType<typeof page>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReturnType<typeof page>>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let wrapper: ReturnType<typeof shallowMount> | undefined;
let frames: Map<number, FrameRequestCallback>;
let frameId = 0;
async function settle() {
  await flushPromises();
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(performance.now()));
  await nextTick();
  await flushPromises();
}
function mountView() {
  wrapper = shallowMount(LogView, {
    attachTo: document.body,
    global: {
      plugins: [getActivePinia()!],
      stubs: {
        Splitpanes: { template: "<div><slot /></div>" },
        Pane: { template: "<div><slot /></div>" },
        ErrorState: false,
        EmptyState: false,
        Tip: { template: "<span><slot /></span>" },
        Button: { template: "<button><slot /></button>" },
        VirtualList: {
          props: ["items"],
          methods: { scrollToIndex() {} },
          template:
            '<div><slot v-for="(item, index) in items" :item="item" :index="index" /></div>',
        },
      },
    },
  });
  return wrapper;
}
function button(text: string) {
  const result = wrapper!.findAll("button").find((item) => item.text() === text);
  expect(result, `button ${text} must remain reachable`).toBeDefined();
  return result!;
}
function field(name: string) {
  return wrapper!.get<HTMLInputElement>(`input[placeholder="log.${name}Placeholder"]`);
}

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  frames = new Map();
  frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  mocks.ws = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    generation: 0,
    navigationToken: () => mocks.ws.generation,
  });
  mocks.backend.logQuery.mockResolvedValue(page());
  mocks.backend.logCommitDetails.mockImplementation(async ({ sha }) => ({
    ...commit(sha),
    body: "",
  }));
  mocks.backend.logChangedFiles.mockResolvedValue([]);
  mocks.backend.logIndexStatus.mockResolvedValue(null);
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  useLogStore().$dispose();
  useJobsStore().$dispose();
  vi.unstubAllGlobals();
});

it("keeps filter inputs and an accessible retry when the first history query fails", async () => {
  mocks.backend.logQuery.mockRejectedValueOnce(new Error("cannot read repository"));
  const view = mountView();
  await settle();
  expect(view.find('input[placeholder="log.searchPlaceholder"]').exists()).toBe(true);
  expect(view.find('input[placeholder="log.branchPlaceholder"]').exists()).toBe(true);
  expect(view.get('[role="alert"]').text()).toContain("cannot read repository");
  expect(view.text()).not.toContain("log.noMatchesTitle");
  button("log.retryLoadMore");
});

it("corrects an invalid branch in place without exposing stale rows as matching results", async () => {
  mocks.backend.logQuery.mockResolvedValueOnce(page("previous history"));
  const view = mountView();
  await settle();
  await field("branch").setValue("missing-branch");
  mocks.backend.logQuery.mockRejectedValueOnce(new Error("bad revision missing-branch"));
  await button("common.apply").trigger("click");
  await settle();
  expect(field("branch").element.value).toBe("missing-branch");
  expect(view.findAll('[role="option"]')).toHaveLength(0);
  expect(view.get('[role="alert"]').text()).toContain("bad revision");
  mocks.backend.logQuery.mockResolvedValueOnce(page("correct history"));
  await field("branch").setValue("main");
  await field("branch").trigger("keydown", { key: "Enter" });
  await settle();
  expect(mocks.backend.logQuery.mock.lastCall![0].filters.revisions).toEqual(["main"]);
  expect(view.find('[role="alert"]').exists()).toBe(false);
  expect(view.get('[role="option"]').text()).toContain("correct history");
});

it.each(["search", "user", "branch", "paths"])(
  "keeps %s drafts local during composition, consumed, repeated and modified Enter",
  async (name) => {
    mocks.backend.logQuery.mockResolvedValue(page("existing"));
    mountView();
    await settle();
    const log = useLogStore();
    const filters = JSON.stringify(log.filters);
    await field(name).setValue("中文草稿");
    mocks.backend.logQuery.mockClear();
    const effects = [];
    for (const options of [
      { isComposing: true },
      { keyCode: 229 },
      { consumed: true },
      { repeat: true },
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { shiftKey: true },
    ]) {
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...options,
      });
      if ("consumed" in options) event.preventDefault();
      field(name).element.dispatchEvent(event);
      await settle();
      effects.push({
        queries: mocks.backend.logQuery.mock.calls.length,
        filters: JSON.stringify(log.filters),
        selection: log.selectedSha,
        draft: field(name).element.value,
      });
    }
    expect(effects).toEqual(
      Array.from({ length: 8 }, () => ({
        queries: 0,
        filters,
        selection: "existing",
        draft: "中文草稿",
      })),
    );
  },
);

it("applies all four completed drafts once on ordinary Enter and permits a later query", async () => {
  mountView();
  await settle();
  await field("search").setValue("修复");
  await field("user").setValue("QA");
  await field("branch").setValue("main");
  await field("paths").setValue("src/中文.ts");
  mocks.backend.logQuery.mockClear();
  await field("search").trigger("keydown", { key: "Enter" });
  await settle();
  expect(mocks.backend.logQuery).toHaveBeenCalledTimes(1);
  expect(mocks.backend.logQuery.mock.lastCall![0].filters).toMatchObject({
    text: "修复",
    authors: ["QA"],
    revisions: ["main"],
    paths: ["src/中文.ts"],
  });
  await field("search").trigger("keydown", { key: "Enter", repeat: true });
  await field("search").trigger("keydown", { key: "Enter", repeat: true });
  await settle();
  expect(mocks.backend.logQuery).toHaveBeenCalledTimes(1);
  await field("user").setValue("Other author");
  await field("user").trigger("keydown", { key: "Enter" });
  await settle();
  expect(mocks.backend.logQuery).toHaveBeenCalledTimes(2);
  expect(mocks.backend.logQuery.mock.lastCall![0].filters.authors).toEqual(["Other author"]);
});

it("retries again after another failure and restores a useful keyboard focus", async () => {
  const log = useLogStore();
  log.setTextFilter("release");
  mocks.backend.logQuery.mockRejectedValueOnce(new Error("temporarily offline"));
  mountView();
  await settle();
  mocks.backend.logQuery.mockRejectedValueOnce(new Error("still offline"));
  await button("log.retryLoadMore").trigger("click");
  await settle();
  expect(wrapper!.get('[role="alert"]').text()).toContain("still offline");
  expect(log.filters.text).toBe("release");
  expect(document.activeElement).toBe(field("search").element);
  mocks.backend.logQuery.mockResolvedValueOnce(page("release found"));
  await button("log.retryLoadMore").trigger("click");
  await settle();
  expect(log.selectedSha).toBe("release found");
  expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
  expect(document.activeElement).toBe(field("search").element);
});

it.each(["clear", "chip"])("recovers a failed filter using %s", async (action) => {
  useLogStore().setRevisions(["missing-branch"]);
  mocks.backend.logQuery.mockRejectedValueOnce(new Error("bad revision"));
  mountView();
  await settle();
  mocks.backend.logQuery.mockResolvedValueOnce(page("unfiltered history"));
  await button(action === "clear" ? "log.clear" : "log.chipBranch ×").trigger("click");
  await settle();
  expect(useLogStore().filters.revisions).toEqual([]);
  expect(field("branch").element.value).toBe("");
  expect(useLogStore().selectedSha).toBe("unfiltered history");
});

it("announces a pending query and keeps its task until it returns a genuine empty result", async () => {
  const pending = deferred();
  mocks.backend.logQuery.mockReturnValueOnce(pending.promise);
  const view = mountView();
  await settle();
  expect(view.text()).not.toContain("log.noMatchesTitle");
  expect(view.get('[role="status"]').text()).toContain("log.loadingHistory");
  expect(view.find('[aria-busy="true"]').exists()).toBe(true);
  expect(useJobsStore().running).toEqual([
    expect.objectContaining({ title: "log.loadingHistory", message: "A" }),
  ]);
  pending.resolve(page());
  await settle();
  expect(view.text()).toContain("log.noMatchesTitle");
  expect(view.find('[aria-busy="true"]').exists()).toBe(false);
  expect(useJobsStore().count).toBe(0);
});

it("keeps overlapping query tasks separate and rejects the obsolete failure", async () => {
  const old = deferred();
  const current = deferred();
  mocks.backend.logQuery.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const view = mountView();
  await settle();
  await field("search").setValue("new query");
  await button("common.apply").trigger("click");
  await settle();
  expect(useJobsStore().count).toBe(2);
  old.reject(new Error("obsolete failure"));
  await settle();
  expect(useJobsStore().count).toBe(1);
  expect(useLogStore().loading).toBe(true);
  expect(view.text()).not.toContain("obsolete failure");
  current.resolve(page("new result"));
  await settle();
  expect(useJobsStore().count).toBe(0);
  expect(useLogStore().selectedSha).toBe("new result");
});

it("retains the existing history and silent query queue during a failed background refresh", async () => {
  mocks.backend.logQuery.mockResolvedValueOnce(page("existing"));
  const view = mountView();
  await settle();
  const pending = deferred();
  mocks.backend.logQuery.mockReturnValueOnce(pending.promise);
  const refresh = useLogStore().load(true, true);
  await settle();
  expect(useJobsStore().count).toBe(0);
  expect(view.find('[role="status"]').exists()).toBe(false);
  pending.reject(new Error("refresh failed"));
  await refresh;
  await settle();
  expect(view.find('[role="alert"]').exists()).toBe(false);
  expect(view.get('[role="option"]').text()).toContain("existing");
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({ description: "refresh failed" }),
  );
});

it.each([false, true])(
  "finishes the old repository task without replacing the new view (failure=%s)",
  async (failure) => {
    const old = deferred();
    mocks.backend.logQuery
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(page("repository B"));
    const view = mountView();
    await settle();
    mocks.ws.repoPath = "B";
    mocks.ws.repoId = "B";
    mocks.ws.generation++;
    await settle();
    expect(useLogStore().selectedSha).toBe("repository B");
    expect(useJobsStore().running).toEqual([
      expect.objectContaining({ title: "log.loadingHistory", message: "A" }),
    ]);
    if (failure) old.reject(new Error("old repository unavailable"));
    else old.resolve(page("repository A"));
    await settle();
    expect(useJobsStore().count).toBe(0);
    expect(view.find('[role="alert"]').exists()).toBe(false);
    expect(view.get('[role="option"]').text()).toContain("repository B");
  },
);

it("finishes the history task while keeping the actual details read visible", async () => {
  let finishDetails!: (files: []) => void;
  mocks.backend.logQuery.mockResolvedValueOnce(page("selected"));
  mocks.backend.logChangedFiles.mockReturnValueOnce(
    new Promise<[]>((resolve) => {
      finishDetails = resolve;
    }),
  );
  const view = mountView();
  await settle();
  expect(useLogStore().loading).toBe(false);
  expect(view.text()).not.toContain("log.loadingHistory");
  expect(useJobsStore().running).toEqual([
    expect.objectContaining({ title: "log.loadingDetails", message: "A" }),
  ]);
  finishDetails([]);
  await settle();
  expect(useJobsStore().count).toBe(0);
});
