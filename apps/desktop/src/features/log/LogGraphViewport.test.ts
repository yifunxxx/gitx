import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { reactive, ref } from "vue";
import LogView from "./LogView.vue";
import CommitGraphCell from "./CommitGraphCell.vue";
import VirtualList from "@/components/common/VirtualList.vue";

const mocks = vi.hoisted(() => ({ log: {} as any }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => mocks.log }));
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: () => ({
    repoPath: "repo",
    repoId: "repo",
    isRepo: true,
    navigationToken: () => 0,
  }),
}));
vi.mock("@/stores/branchesStore", () => ({
  useBranchesStore: () => ({ refs: { local: [], remote: [], tags: [] }, remotes: [] }),
}));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => ({}) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => ({}) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({}) }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({}) }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => ({}) }));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({
    settings: { git: { logListMode: "flat" } },
    emptySettings: () => ({ git: { logListMode: "flat" } }),
    save: vi.fn(),
  }),
}));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: ref("en") }) }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/composables/useConfirm", () => ({
  confirmDialog: vi.fn(),
  promptDialog: vi.fn(),
}));

class Observer {
  static instances: Observer[] = [];
  width = 600;
  disconnect = vi.fn();
  constructor(private callback: () => void) {
    Observer.instances.push(this);
  }
  observe(element: HTMLElement) {
    Object.defineProperty(element, "clientWidth", { configurable: true, get: () => this.width });
    this.callback();
  }
  resize(width: number) {
    this.width = width;
    this.callback();
  }
}

const commit = (sha: string, parents: string[] = []) => ({
  sha,
  shortSha: sha,
  parents,
  refs: [],
  subject: sha,
  author: "Author",
  authorTime: 0,
  graph: { lane: 0, color: 0, edges: [] },
});
let wrapper: ReturnType<typeof shallowMount>;
beforeEach(async () => {
  Observer.instances = [];
  vi.stubGlobal("ResizeObserver", Observer);
  const parents = Array.from({ length: 40 }, (_, i) => `side-${i}`);
  mocks.log = reactive({
    commits: [commit("merge", parents), ...parents.map((p) => commit(p, ["root"])), commit("root")],
    selectedSha: "merge",
    selectedShas: ["merge"],
    filters: {},
    changedFiles: [],
    activeFilterChips: [],
    compactRefs: true,
    showTagNames: true,
    load: vi.fn(),
    loadMore: vi.fn(),
  });
  wrapper = shallowMount(LogView, {
    global: {
      stubs: {
        Splitpanes: { template: "<div><slot /></div>" },
        Pane: { template: "<div><slot /></div>" },
        VirtualList: {
          props: ["items"],
          template:
            '<div><div v-for="(item, index) in items" :key="item.sha"><slot :item="item" :index="index" /></div></div>',
        },
      },
    },
  });
  await flushPromises();
});
afterEach(() => {
  wrapper.unmount();
  vi.unstubAllGlobals();
});

function slider() {
  return wrapper.get('input[type="range"]');
}
function offset() {
  return Number((slider().element as HTMLInputElement).value);
}
function graphWidth() {
  const header = wrapper
    .findAll("div[style]")
    .find((node) => node.attributes("style")?.includes("grid-template-columns"))!;
  return parseFloat((header.element as HTMLElement).style.gridTemplateColumns);
}

it("keeps a forty-branch graph bounded and pans all rows together", async () => {
  expect(graphWidth()).toBeLessThanOrEqual(600 * 0.35);
  const maximum = Number(slider().attributes("max"));
  expect(maximum).toBeGreaterThan(0);
  await slider().setValue(maximum);
  expect(
    wrapper
      .findAllComponents(CommitGraphCell)
      .every((cell) => cell.attributes("style")?.includes(`translateX(-${maximum}px)`)),
  ).toBe(true);
});

it("reveals a selected offscreen node after panning and resizing", async () => {
  mocks.log.selectedSha = "side-39";
  await flushPromises();
  const cell = wrapper.findAllComponents(CommitGraphCell)[40]!;
  const nodeX = 6 + (cell.props("graph").lane + 0.5) * (cell.props("laneWidth") ?? 16);
  expect(offset()).toBeGreaterThan(0);
  expect(nodeX - offset()).toBeGreaterThanOrEqual(8);
  expect(nodeX - offset()).toBeLessThanOrEqual(graphWidth() - 8);
  Observer.instances[0]!.resize(1000);
  await flushPromises();
  expect(nodeX - offset()).toBeLessThanOrEqual(graphWidth() - 8);
  mocks.log.selectedSha = "merge";
  await flushPromises();
  expect(offset()).toBeLessThanOrEqual(5);
});

it("moves column headings with horizontal list scrolling", async () => {
  wrapper.findComponent(VirtualList).vm.$emit("scroll", {
    target: { scrollLeft: 75, scrollHeight: 1000, scrollTop: 0, clientHeight: 400 },
  });
  await flushPromises();
  expect(
    wrapper.findAll("div[style]").some((node) => {
      const style = (node.element as HTMLElement).style;
      return style.gridTemplateColumns && style.transform === "translateX(-75px)";
    }),
  ).toBe(true);
});

it("disconnects size observers when results disappear and on unmount", async () => {
  const commits = mocks.log.commits;
  mocks.log.commits = [];
  await flushPromises();
  expect(Observer.instances[0]!.disconnect).toHaveBeenCalledOnce();
  mocks.log.commits = commits;
  await flushPromises();
  expect(Observer.instances).toHaveLength(2);
  wrapper.unmount();
  expect(Observer.instances[1]!.disconnect).toHaveBeenCalledOnce();
});
