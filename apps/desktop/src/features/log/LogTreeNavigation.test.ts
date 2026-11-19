import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive, ref } from "vue";
import { useLogStore } from "@/stores/logStore";
import LogView from "./LogView.vue";

const mocks = vi.hoisted(() => ({
  backend: {
    logLocate: vi.fn(),
    logQuery: vi.fn(),
    logIndexStatus: vi.fn(),
    logCommitDetails: vi.fn(),
    logChangedFiles: vi.fn(),
  },
  ws: {} as any,
  settings: {} as any,
  scroll: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({ remotes: [] }) }));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => ({}) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => ({}) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({}) }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({}) }));
vi.mock("@/stores/rewriteStore", () => ({
  useRewriteStore: () => ({ busy: false, repositoryToken: () => 1 }),
}));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: vi.fn(), promptDialog: vi.fn() }));
vi.mock("@/composables/useDialog", () => ({ openDialog: vi.fn() }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: ref("en") }) }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));

const commit = (sha: string, parents: string[] = [], refs: string[] = []) => ({
  sha,
  shortSha: sha,
  parents,
  refs,
  subject: `subject-${sha}`,
  author: "QA",
  authorEmail: "qa@example.invalid",
  authorTime: 1,
  graph: { lane: 0, color: 0, edges: [] },
});
const original = () => [
  commit("a", ["b"], ["main"]),
  commit("c", ["root"], ["feature"]),
  commit("b", ["root"]),
  commit("root"),
];
let wrapper: ReturnType<typeof shallowMount>;
let nextFrameId = 0;
let frames: Map<number, FrameRequestCallback>;

async function renderFrame() {
  await nextTick();
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(0));
  await flushPromises();
}

beforeEach(async () => {
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
  mocks.backend.logIndexStatus.mockResolvedValue(null);
  mocks.backend.logCommitDetails.mockImplementation(async ({ sha }) => commit(sha));
  mocks.backend.logChangedFiles.mockResolvedValue([]);
  const log = useLogStore();
  vi.spyOn(log, "load").mockResolvedValue();
  log.commits = original();
  await log.select("a");
  wrapper = shallowMount(LogView, {
    global: {
      stubs: {
        Splitpanes: { template: "<div><slot /></div>" },
        Pane: { template: "<div><slot /></div>" },
        Tip: { template: "<span><slot /></span>" },
        Button: { template: "<button><slot /></button>" },
        VirtualList: {
          props: ["items"],
          methods: { scrollToIndex: mocks.scroll },
          template:
            '<div><slot v-for="(item, index) in items" :item="item" :index="index" /></div>',
        },
      },
    },
  });
  await flushPromises();
  await renderFrame();
});
afterEach(() => {
  wrapper.unmount();
  vi.unstubAllGlobals();
});

function row(sha: string) {
  return wrapper
    .findAll('[role="option"]')
    .find((element) => element.text().includes(`subject-${sha}`))!;
}

it.each([
  { key: "ArrowDown", from: "a", to: "b", index: 2 },
  { key: "ArrowDown", from: "root", to: "c", index: 5 },
  { key: "ArrowUp", from: "c", to: "root", index: 3 },
  { key: "Home", from: "c", to: "a", index: 1 },
  { key: "End", from: "a", to: "c", index: 5 },
])(
  "$key selects $to in displayed tree order, skipping group headings",
  async ({ key, from, to, index }) => {
    const log = useLogStore();
    await log.select(from);
    await row(from).trigger("keydown", { key });
    await flushPromises();
    expect(log.selectedSha).toBe(to);
    expect(mocks.scroll).toHaveBeenLastCalledWith(index);
  },
);

it.each([
  { key: "ArrowLeft", from: "c", to: "root", index: 3 },
  { key: "ArrowRight", from: "root", to: "c", index: 5 },
])(
  "preserves $key parent/child choice and reveals the correct tree row",
  async ({ key, from, to, index }) => {
    const log = useLogStore();
    await log.select(from);
    await row(from).trigger("keydown", { key });
    await flushPromises();
    expect(log.selectedSha).toBe(to);
    expect(mocks.scroll).toHaveBeenLastCalledWith(index);
  },
);

it("Shift-click selects only the displayed range", async () => {
  await row("b").trigger("click", { shiftKey: true });
  expect(useLogStore().selectedShas).toEqual(["a", "b"]);
});

it("Shift+ArrowDown extends the range by the next displayed commit", async () => {
  await row("a").trigger("keydown", { key: "ArrowDown", shiftKey: true });
  await flushPromises();
  expect(useLogStore().selectedShas).toEqual(["a", "b"]);
  expect(mocks.scroll).toHaveBeenLastCalledWith(2);
});

it("keeps the Ctrl selection anchor when a range crosses tree groups", async () => {
  await row("c").trigger("click", { ctrlKey: true });
  expect(useLogStore().selectedShas).toEqual(["a", "c"]);
  await row("b").trigger("click", { shiftKey: true });
  expect(useLogStore().selectedShas).toEqual(["b", "root", "c"]);
});

it("go-to centers the selected tree row including group headings", async () => {
  mocks.backend.logLocate.mockResolvedValue({ sha: "c", offset: 1 });
  const field = wrapper.get<HTMLInputElement>('input[placeholder="log.goToPlaceholder"]');
  await field.setValue("feature");
  await field.trigger("keydown", { key: "Enter" });
  await flushPromises();
  expect(useLogStore().selectedSha).toBe("c");
  expect(mocks.scroll).toHaveBeenLastCalledWith(5, "center");
});

function prepareNewWindow() {
  mocks.backend.logLocate.mockResolvedValue({ sha: "y", offset: 9001 });
  mocks.backend.logQuery.mockResolvedValue({
    commits: [commit("x", ["z"], ["main"]), commit("y", [], ["side"]), commit("z")],
    nextOffset: 9101,
    truncated: true,
  });
}

async function jumpToNewWindow() {
  prepareNewWindow();
  const field = wrapper.get<HTMLInputElement>('input[placeholder="log.goToPlaceholder"]');
  await field.setValue("y");
  await field.trigger("keydown", { key: "Enter" });
  await flushPromises();
}

it("waits for the newly loaded tree before revealing a distant target", async () => {
  await jumpToNewWindow();
  expect(useLogStore().selectedSha).toBe("y");
  expect(mocks.scroll).not.toHaveBeenCalled();
  await renderFrame();
  expect(mocks.scroll).toHaveBeenCalledExactlyOnceWith(4, "center");
});

it("waits for tree rows when parent navigation loads another history window", async () => {
  const log = useLogStore();
  log.commits = [commit("tip", ["y"], ["main"])];
  await log.select("tip");
  await renderFrame();
  prepareNewWindow();
  await row("tip").trigger("keydown", { key: "ArrowLeft" });
  await flushPromises();
  expect(log.selectedSha).toBe("y");
  expect(mocks.scroll).not.toHaveBeenCalled();
  await renderFrame();
  expect(mocks.scroll).toHaveBeenCalledExactlyOnceWith(4);
});

it("uses the latest queued tree layout when commits change again before rendering", async () => {
  await jumpToNewWindow();
  useLogStore().commits = [commit("y", [], ["side"]), commit("x", ["z"], ["main"]), commit("z")];
  await renderFrame();
  expect(mocks.scroll).toHaveBeenCalledExactlyOnceWith(1, "center");
});

it("releases a queued tree reveal on unmount without scrolling a disposed list", async () => {
  await jumpToNewWindow();
  wrapper.unmount();
  await renderFrame();
  expect(mocks.scroll).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});

it("uses flat row positions if the display mode changes before the queued tree renders", async () => {
  await jumpToNewWindow();
  mocks.settings.settings.git.logListMode = "flat";
  await flushPromises();
  expect(mocks.scroll).toHaveBeenCalledExactlyOnceWith(1, "center");
});

it("ignores an obsolete tree reveal after the user selects a different commit", async () => {
  await jumpToNewWindow();
  await useLogStore().select("x");
  await renderFrame();
  expect(mocks.scroll).not.toHaveBeenCalled();
});

it("does not reveal a pending target after switching repositories", async () => {
  await jumpToNewWindow();
  mocks.ws.repoPath = "B";
  mocks.ws.repoId = "B";
  await renderFrame();
  expect(mocks.scroll).not.toHaveBeenCalled();
});

it("retains flat keyboard, range and jump behavior after switching from tree mode", async () => {
  const log = useLogStore();
  mocks.settings.settings.git.logListMode = "flat";
  await flushPromises();
  await row("a").trigger("keydown", { key: "ArrowDown" });
  await flushPromises();
  expect(log.selectedSha).toBe("c");
  expect(mocks.scroll).toHaveBeenLastCalledWith(1);
  await log.select("a");
  await row("b").trigger("click", { shiftKey: true });
  expect(log.selectedShas).toEqual(["a", "c", "b"]);
  mocks.backend.logLocate.mockResolvedValue({ sha: "b", offset: 2 });
  const field = wrapper.get<HTMLInputElement>('input[placeholder="log.goToPlaceholder"]');
  await field.setValue("b");
  await field.trigger("keydown", { key: "Enter" });
  await flushPromises();
  expect(mocks.scroll).toHaveBeenLastCalledWith(2, "center");
});
