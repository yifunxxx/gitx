import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import FileHistoryView from "./FileHistoryView.vue";
import RepoAtRevisionView from "./RepoAtRevisionView.vue";
import CompareView from "@/features/compare/CompareView.vue";
import UpdateInfoView from "@/features/sync/UpdateInfoView.vue";
import VirtualList from "@/components/common/VirtualList.vue";

const mocks = vi.hoisted(() => ({
  history: {} as any,
  revision: {} as any,
  compare: {} as any,
  sync: {} as any,
}));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => mocks.history }));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => mocks.revision }));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => mocks.compare }));
vi.mock("@/stores/syncStore", () => ({ useSyncStore: () => mocks.sync }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({}) }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => ({}) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({}) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
const global = {
  stubs: {
    Splitpanes: { template: "<div><slot /></div>" },
    Pane: { template: "<div><slot /></div>" },
    PathTreeList: true,
  },
};
const commits = Array.from({ length: 10000 }, (_, i) => ({
  sha: `sha-${i}`,
  shortSha: `${i}`,
  subject: `commit ${i}`,
  author: "Author",
  authorTime: 0,
  pathAtCommit: "file",
}));
async function last(list: VueWrapper) {
  (list.vm as unknown as { scrollToIndex(index: number): void }).scrollToIndex(9999);
  await flushPromises();
}

it("bounds file history DOM and still selects the final revision", async () => {
  mocks.history = reactive({ tabs: [{ id: "tab", filePath: "file", commits }], select: vi.fn() });
  const wrapper = mount(FileHistoryView, { props: { tabId: "tab" }, global });
  const list = wrapper.findComponent(VirtualList);
  expect(list.findAll("button").length).toBeLessThan(40);
  await last(list);
  await list.findAll("button").at(-1)!.trigger("click");
  expect(mocks.history.select).toHaveBeenCalledWith(mocks.history.tabs[0], "sha-9999");
});

it("bounds historical directories and resets their scroll position on directory navigation", async () => {
  const entries = commits.map((_c, i) => ({ path: `dir/${i}`, name: `file ${i}`, kind: "blob" }));
  mocks.revision = reactive({
    tabs: [{ id: "tab", rev: "rev", dir: "dir", entries }],
    openEntry: vi.fn(),
  });
  const wrapper = mount(RepoAtRevisionView, { props: { tabId: "tab" }, global });
  const list = wrapper.findComponent(VirtualList);
  expect(list.findAll("button").length).toBeLessThan(40);
  await last(list);
  await list.findAll("button").at(-1)!.trigger("click");
  expect(mocks.revision.openEntry).toHaveBeenCalledWith(mocks.revision.tabs[0], entries[9999]);
  mocks.revision.tabs[0].dir = "next";
  await flushPromises();
  expect(wrapper.findComponent(VirtualList).get(".overflow-auto").element.scrollTop).toBe(0);
});

it("bounds both comparison commit lists and update results", async () => {
  mocks.compare = reactive({
    tabs: [{ id: "tab", mode: "refs", leftOnly: commits, rightOnly: commits, files: [] }],
  });
  const comparison = mount(CompareView, { props: { tabId: "tab" }, global });
  for (const list of comparison.findAllComponents(VirtualList)) {
    expect(list.text()).not.toContain("commit 9999");
    await last(list);
    expect(list.text()).toContain("commit 9999");
  }
  mocks.sync = reactive({
    lastUpdate: {
      oldHead: "old",
      newHead: "new",
      updatedFiles: [],
      commits: commits.map((c) => c.subject),
    },
  });
  const updates = mount(UpdateInfoView, { global });
  const list = updates.findComponent(VirtualList);
  expect(list.text()).not.toContain("commit 9999");
  await last(list);
  expect(list.text()).toContain("commit 9999");
});
