import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { reactive, ref } from "vue";
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
  ws: {} as { repoPath: string; repoId: string; isRepo: boolean; navigationToken: () => number },
  rewrite: { busy: false, repositoryToken: () => 1, drop: vi.fn(), extractChanges: vi.fn() },
  confirm: vi.fn(),
  prompt: vi.fn(),
  open: vi.fn(),
  scroll: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({ remotes: [] }) }));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => ({}) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => ({}) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({}) }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({}) }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({
    settings: { git: { logListMode: "flat" } },
    emptySettings: () => ({ git: { logListMode: "flat" } }),
    save: vi.fn(),
  }),
}));
vi.mock("@/composables/useConfirm", () => ({
  confirmDialog: mocks.confirm,
  promptDialog: mocks.prompt,
}));
vi.mock("@/composables/useDialog", () => ({ openDialog: mocks.open }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: ref("en") }) }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.ws = reactive({ repoPath: "A", repoId: "A", isRepo: true, navigationToken: () => 1 });
  mocks.backend.logQuery.mockResolvedValue({ commits: [], nextOffset: 0, truncated: false });
  mocks.backend.logIndexStatus.mockResolvedValue(null);
  mocks.backend.logCommitDetails.mockResolvedValue(null);
  mocks.backend.logChangedFiles.mockResolvedValue([]);
});

const mountView = () =>
  shallowMount(LogView, {
    global: {
      stubs: {
        Splitpanes: { template: "<div><slot /></div>" },
        Pane: { template: "<div><slot /></div>" },
        VirtualList: {
          props: ["items"],
          methods: { scrollToIndex: mocks.scroll },
          template:
            '<div><slot v-for="(item, index) in items" :item="item" :index="index" /></div>',
        },
        Tip: { template: "<span><slot /></span>" },
        Button: { template: "<button><slot /></button>" },
      },
    },
  });

it("centers a resolved target and shows navigation errors without changing filters", async () => {
  const wrapper = mountView();
  await flushPromises();
  const log = useLogStore();
  mocks.backend.logLocate.mockResolvedValue({ sha: "target", offset: 9000 });
  mocks.backend.logQuery.mockResolvedValue({
    commits: [
      {
        sha: "target",
        shortSha: "target",
        parents: [],
        refs: [],
        subject: "Target",
        author: "QA",
        authorEmail: "qa@example.invalid",
        authorTime: 1,
        graph: { lane: 0, edges: [], color: 0 },
      },
    ],
    nextOffset: 9001,
    truncated: false,
  });
  const field = wrapper.get<HTMLInputElement>('input[placeholder="log.goToPlaceholder"]');
  await field.setValue("main");
  await field.trigger("keydown", { key: "Enter", isComposing: true });
  expect(mocks.backend.logLocate).not.toHaveBeenCalled();
  await field.trigger("keydown", { key: "Enter" });
  await flushPromises();
  expect(log.selectedSha).toBe("target");
  expect(mocks.scroll).toHaveBeenLastCalledWith(0, "center");
  expect(wrapper.text()).toContain("log.backToLatest");
  mocks.backend.logLocate.mockRejectedValue(new Error("Unknown revision"));
  await field.setValue("missing");
  await field.trigger("keydown", { key: "Enter" });
  await flushPromises();
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({ description: "Unknown revision" }),
  );
  expect(log.filters.text).toBeNull();
  expect(log.selectedSha).toBe("target");
  wrapper.unmount();
});

it("offers explicit filter clearing for hidden targets even when the current list is empty", async () => {
  const wrapper = mountView();
  await flushPromises();
  const log = useLogStore();
  log.setTextFilter("other message");
  mocks.backend.logLocate.mockResolvedValue({ sha: "hidden", offset: null });
  const field = wrapper.get<HTMLInputElement>('input[placeholder="log.goToPlaceholder"]');
  await field.setValue("hidden");
  await field.trigger("keydown", { key: "Enter" });
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toContain("log.commitOutsideHistory");
  expect(wrapper.findAll("button").some((b) => b.text() === "log.clearAndGo")).toBe(true);
  expect(log.filters.text).toBe("other message");
  expect(mocks.scroll).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("clears applied filters and stale drafts in the query sent by the Clear button", async () => {
  const wrapper = mountView();
  await flushPromises();
  const fields = wrapper.findAll("input");
  await fields[0]!.setValue("old message");
  await fields[1]!.setValue("old author");
  await fields[2]!.setValue("old branch");
  await fields[3]!.setValue("old/path");
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "common.apply")!
    .trigger("click");
  await flushPromises();
  expect(useLogStore().filters.text).toBe("old message");
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "log.clear")!
    .trigger("click");
  await flushPromises();
  expect(mocks.backend.logQuery.mock.lastCall![0].filters).toMatchObject({
    text: null,
    authors: [],
    revisions: [],
    paths: [],
    since: null,
  });
  for (const input of wrapper.findAll<HTMLInputElement>("input").slice(0, 4)) {
    expect(input.element.value).toBe("");
  }
  wrapper.unmount();
});

it("restores filter controls on remount and reflects the selected date preset", async () => {
  const log = useLogStore();
  log.setTextFilter("saved filter");
  log.setDatePreset("7d");
  const wrapper = mountView();
  await flushPromises();
  expect(wrapper.get<HTMLInputElement>("input").element.value).toBe("saved filter");
  expect(wrapper.findComponent({ name: "Select" }).props("modelValue")).toBe("7d");
  log.clearAllFilters();
  await flushPromises();
  expect(wrapper.findComponent({ name: "Select" }).props("modelValue")).toBe("all");
  wrapper.unmount();
});

it("keeps a wide graph separate from text and reveals a selected node after manual panning", async () => {
  const log = useLogStore();
  vi.spyOn(log, "load").mockResolvedValue();
  const row = (sha: string, parents: string[]) => ({
    sha,
    shortSha: sha,
    parents,
    refs: [],
    subject: sha,
    author: "QA",
    authorEmail: "qa@example.invalid",
    authorTime: 1,
    graph: { lane: 0, color: 0, edges: [] },
  });
  log.commits = [
    ...Array.from({ length: 40 }, (_, i) => row(`branch-${i}`, [`root-${i}`])),
    row("root-0", []),
  ];
  log.selectedSha = "branch-0";
  const wrapper = shallowMount(LogView, {
    global: {
      stubs: {
        Splitpanes: { template: "<div><slot /></div>" },
        Pane: { template: "<div><slot /></div>" },
        Tip: { template: "<span><slot /></span>" },
      },
    },
  });
  await flushPromises();
  const slider = wrapper.get<HTMLInputElement>('input[type="range"]');
  expect(Number(slider.attributes("max"))).toBeGreaterThan(200);
  await slider.setValue("250");
  expect(slider.element.value).toBe("250");
  // Both commits have the same lane. Changing the selected SHA must still
  // restore that node after the user panned the graph away from it.
  log.selectedSha = "root-0";
  await flushPromises();
  expect(slider.element.value).toBe("5");
  wrapper.unmount();
});

it("handles Ctrl toggles, Shift ranges and right-clicks through actual commit rows", async () => {
  const log = useLogStore();
  vi.spyOn(log, "load").mockResolvedValue();
  log.commits = ["a", "b", "c", "d"].map((sha) => ({
    sha,
    shortSha: sha,
    parents: [],
    refs: [],
    subject: sha,
    author: "QA",
    authorEmail: "qa@example.invalid",
    authorTime: 1,
    graph: { lane: 0, color: 0, edges: [] },
  }));
  const wrapper = shallowMount(LogView, {
    global: {
      stubs: {
        Splitpanes: { template: "<div><slot /></div>" },
        Pane: { template: "<div><slot /></div>" },
        Tip: { template: "<span><slot /></span>" },
        VirtualList: {
          props: ["items"],
          template:
            '<div><slot v-for="(item, index) in items" :item="item" :index="index" /></div>',
        },
      },
    },
  });
  const rows = wrapper.findAll('[role="option"]');
  expect(rows).toHaveLength(4);
  await rows[0]!.trigger("click");
  await rows[2]!.trigger("click", { ctrlKey: true });
  expect(log.selectedShas).toEqual(["a", "c"]);
  expect(rows[0]!.attributes("aria-selected")).toBe("true");
  expect(rows[1]!.attributes("aria-selected")).toBe("false");
  await rows[0]!.trigger("contextmenu");
  expect(log.selectedShas).toEqual(["a", "c"]);
  await rows[2]!.trigger("click", { ctrlKey: true });
  expect(log.selectedShas).toEqual(["a"]);
  await rows[3]!.trigger("click", { shiftKey: true });
  expect(log.selectedShas).toEqual(["a", "b", "c", "d"]);
  await rows[0]!.trigger("click");
  await rows[2]!.trigger("contextmenu");
  expect(log.selectedShas).toEqual(["c"]);
  await rows[2]!.trigger("keydown", { key: "ArrowUp", shiftKey: true });
  expect(log.selectedShas).toEqual(["b", "c"]);
  expect(log.selectedSha).toBe("b");
  await rows[1]!.trigger("keydown", { key: "End" });
  expect(log.selectedSha).toBe("d");
  await rows[3]!.trigger("keydown", { key: "Home", isComposing: true });
  expect(log.selectedSha).toBe("d");
  await rows[3]!.trigger("keydown", { key: "Home" });
  expect(log.selectedSha).toBe("a");
  wrapper.unmount();
});
