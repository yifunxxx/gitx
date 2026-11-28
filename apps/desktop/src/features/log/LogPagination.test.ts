import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive, ref } from "vue";
import { useLogStore } from "@/stores/logStore";
import VirtualList from "@/components/common/VirtualList.vue";
import LogView from "./LogView.vue";

const mocks = vi.hoisted(() => ({
  backend: {
    logQuery: vi.fn(),
    logIndexStatus: vi.fn(),
    logCommitDetails: vi.fn(),
    logChangedFiles: vi.fn(),
  },
  ws: {} as {
    repoPath: string;
    repoId: string;
    isRepo: boolean;
    navigation: number;
    navigationToken: () => number;
  },
  settings: {} as { settings: { git: { logListMode: "flat" | "tree" } } },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({ remotes: [] }) }));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => ({}) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => ({}) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({}) }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({}) }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => ({}) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: ref("en") }) }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: vi.fn(), promptDialog: vi.fn() }));

const commits = () =>
  Array.from({ length: 100 }, (_, index) => ({
    sha: `sha-${index}`,
    shortSha: `${index}`,
    subject: `Commit ${index}`,
    parents: index < 99 ? [`sha-${index + 1}`] : [],
    refs: [],
    author: "QA",
    authorEmail: "qa@example.invalid",
    authorTime: 1,
    graph: { lane: 0, color: 0, edges: [] },
  }));

let wrapper: ReturnType<typeof shallowMount>;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
async function paint() {
  await nextTick();
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(performance.now()));
  await nextTick();
}
function port() {
  return wrapper.getComponent(VirtualList).get(".overflow-auto");
}
function metrics(top = 1800, height = 2200) {
  Object.defineProperties(port().element, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: height },
  });
  port().element.scrollTop = top;
}
async function scroll(top = 1800) {
  metrics(top);
  await port().trigger("scroll");
  await paint();
}
async function settle() {
  await vi.advanceTimersByTimeAsync(181);
  await flushPromises();
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  frames = new Map();
  frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  setActivePinia(createPinia());
  mocks.ws = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    navigation: 0,
    navigationToken: () => mocks.ws.navigation,
  });
  mocks.settings = reactive({ settings: { git: { logListMode: "flat" } } });
  mocks.backend.logQuery.mockResolvedValue({
    commits: commits(),
    nextOffset: 100,
    truncated: true,
  });
  mocks.backend.logIndexStatus.mockResolvedValue(null);
  mocks.backend.logCommitDetails.mockResolvedValue(null);
  mocks.backend.logChangedFiles.mockResolvedValue([]);
  wrapper = shallowMount(LogView, {
    global: {
      stubs: {
        VirtualList: false,
        Splitpanes: { template: "<div><slot /></div>" },
        Pane: { template: "<div><slot /></div>" },
        Tip: { template: "<span><slot /></span>" },
        Button: { template: "<button><slot /></button>" },
      },
    },
  });
  await flushPromises();
  await paint();
  mocks.backend.logQuery.mockClear();
});
afterEach(() => {
  wrapper.unmount();
  useLogStore().$dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("loads the next page once after a bottom scroll burst settles", async () => {
  for (const top of [1730, 1770, 1800]) await scroll(top);
  await vi.advanceTimersByTimeAsync(179);
  expect(mocks.backend.logQuery).not.toHaveBeenCalled();
  await settle();
  expect(mocks.backend.logQuery).toHaveBeenCalledOnce();
  // The store rereads one overlapping commit to verify page continuity.
  expect(mocks.backend.logQuery.mock.calls[0]![0]).toMatchObject({ path: "A", offset: 99 });
});

it("cancels pagination when the user scrolls away before the debounce expires", async () => {
  await scroll();
  await scroll(100);
  await settle();
  expect(mocks.backend.logQuery).not.toHaveBeenCalled();
});

it("rechecks the viewport if it moves before the next scroll event", async () => {
  await scroll();
  metrics(100);
  await settle();
  expect(mocks.backend.logQuery).not.toHaveBeenCalled();
});

it("rechecks the bottom after content grows without a scroll event", async () => {
  await scroll();
  metrics(1800, 4400);
  await settle();
  expect(mocks.backend.logQuery).not.toHaveBeenCalled();
});

it.each(["same-path", "round-trip", "different-repo"])(
  "does not transfer an old pagination timer across %s navigation",
  async (kind) => {
    await scroll();
    mocks.ws.navigation++;
    if (kind !== "same-path") {
      mocks.ws.repoPath = "B";
      mocks.ws.repoId = "B";
      if (kind === "round-trip") {
        mocks.ws.repoPath = "A";
        mocks.ws.repoId = "A";
      }
    }
    await flushPromises();
    await paint();
    // New repository's legitimate first-page read is separate from pagination.
    mocks.backend.logQuery.mockClear();
    await settle();
    expect(mocks.backend.logQuery).not.toHaveBeenCalled();
  },
);

it.each(["replace", "in-place-round-trip"])(
  "cancels pagination when filters change (%s)",
  async (kind) => {
    await scroll();
    const log = useLogStore();
    if (kind === "replace") log.setTextFilter("new query");
    else {
      log.filters.paths!.push("src");
      log.filters.paths!.pop();
    }
    await settle();
    expect(mocks.backend.logQuery).not.toHaveBeenCalled();
  },
);

it("cancels old pagination when the displayed page is replaced", async () => {
  await scroll();
  useLogStore().commits = commits();
  await paint();
  await settle();
  expect(mocks.backend.logQuery).not.toHaveBeenCalled();
});

it("does not inherit pagination across a flat/tree mode round trip", async () => {
  await scroll();
  mocks.settings.settings.git.logListMode = "tree";
  mocks.settings.settings.git.logListMode = "flat";
  await paint();
  await settle();
  expect(mocks.backend.logQuery).not.toHaveBeenCalled();
});

it("waits for the held thumb and schedules from its release position", async () => {
  await scroll();
  await port().trigger("pointerdown", { button: 0 });
  await settle();
  expect(mocks.backend.logQuery).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("pointerup"));
  await settle();
  expect(mocks.backend.logQuery).toHaveBeenCalledOnce();
});

it("allows a fresh bottom gesture after a cancelled request", async () => {
  await scroll();
  await scroll(100);
  await settle();
  mocks.backend.logQuery.mockClear();
  await scroll();
  await settle();
  expect(mocks.backend.logQuery).toHaveBeenCalledOnce();
});

it("cancels the pending pagination on unmount", async () => {
  await scroll();
  wrapper.unmount();
  await settle();
  expect(mocks.backend.logQuery).not.toHaveBeenCalled();
});
