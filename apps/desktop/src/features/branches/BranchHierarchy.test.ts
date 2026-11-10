import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { reactive } from "vue";
import VirtualList from "@/components/common/VirtualList.vue";
import BranchesPane from "./BranchesPane.vue";
import BranchesPopup from "./BranchesPopup.vue";

const mocks = vi.hoisted(() => ({
  branches: {} as any,
  settings: {} as any,
  log: {} as any,
  toast: vi.fn(),
}));
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: any) => (values?.name ? `${key} ${values.name}` : key),
  }),
}));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => mocks.branches }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => mocks.log }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => ({}) }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: vi.fn() }) }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => ({}) }));
vi.mock("@/stores/syncStore", () => ({ useSyncStore: () => ({}) }));
vi.mock("@/actions", () => ({ runAction: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));

const names = ["main", "feature/ui/button", "feature/api/button", "修复/界面/焦点"];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  mocks.branches = reactive({
    filteredLocal: names.map((name) => ({
      name,
      fullName: `refs/heads/${name}`,
      kind: "localBranch",
      isHead: name === "main",
      isFavorite: false,
    })),
    filteredRemote: [],
    filteredTags: [],
    refs: { recent: [] },
    popupOpen: true,
    refresh: vi.fn(),
    checkout: vi.fn(),
    closePopup: vi.fn(),
    toggleFavorite: vi.fn(),
  });
  mocks.settings = reactive({ settings: { git: { groupBranchesByDirectory: true } } });
  mocks.log = {
    filters: { revisions: [] },
    setRevisions: vi.fn(),
    applyFilters: vi.fn(),
    load: vi.fn(),
  };
});

describe("popup recent branches and other references", () => {
  it("filters recent entries with the local results, including Chinese searches", async () => {
    mocks.branches.refs.recent = ["feature/ui/button", "修复/界面/焦点"];
    mocks.branches.filteredLocal = [mocks.branches.filteredLocal[3]];
    const wrapper = shallowMount(BranchesPopup, { global: { stubs: { VirtualList: false } } });
    expect(wrapper.text()).not.toContain("feature/ui/button");
    const recent = wrapper.findAll("button").find((button) => button.text() === "修复/界面/焦点")!;
    expect(recent.exists()).toBe(true);
    await recent.trigger("click", { detail: 0 });
    expect(mocks.branches.checkout).toHaveBeenCalledWith(mocks.branches.filteredLocal[0]);
    wrapper.unmount();
  });

  it("removes deleted and duplicate recent entries while retaining their order", () => {
    mocks.branches.refs.recent = [
      "feature/ui/button",
      "deleted/topic",
      "feature/ui/button",
      "feature/api/button",
    ];
    const wrapper = shallowMount(BranchesPopup, { global: { stubs: { VirtualList: false } } });
    const recentButtons = wrapper.findAll("button").filter((button) => button.text().includes("/"));
    expect(recentButtons.map((button) => button.text())).toEqual([
      "feature/ui/button",
      "feature/api/button",
    ]);
    wrapper.unmount();
  });

  it.each(["recent", "remoteBranch", "tag"])(
    "checks out %s once for double-click activation",
    async (kind) => {
      const entry = { name: "qa/target", fullName: `refs/${kind}/qa/target`, kind };
      if (kind === "recent") {
        mocks.branches.filteredLocal = [{ ...entry, kind: "localBranch" }];
        mocks.branches.refs.recent = [entry.name];
      } else if (kind === "remoteBranch") mocks.branches.filteredRemote = [entry];
      else mocks.branches.filteredTags = [entry];
      const wrapper = shallowMount(BranchesPopup, { global: { stubs: { VirtualList: false } } });
      const branch = wrapper.findAll("button").find((button) => button.text() === entry.name)!;
      await branch.trigger("click", { detail: 1 });
      await branch.trigger("click", { detail: 2 });
      await branch.trigger("dblclick");
      await flushPromises();
      expect(mocks.branches.checkout).toHaveBeenCalledOnce();
      expect(mocks.branches.checkout.mock.calls[0][0].name).toBe(entry.name);
      wrapper.unmount();
    },
  );
});

describe.each([
  ["pane", BranchesPane],
  ["popup", BranchesPopup],
] as const)("%s local branches", (kind, component) => {
  it("keeps a failed checkout open without a success message or duplicate refresh", async () => {
    mocks.branches.checkout.mockResolvedValue(false);
    const wrapper = shallowMount(component, { global: { stubs: { VirtualList: false } } });
    const branch = wrapper.get('button[aria-label="feature/ui/button"]');
    await branch.trigger(kind === "pane" ? "dblclick" : "click", { detail: 1 });
    await flushPromises();
    expect(mocks.branches.checkout).toHaveBeenCalledOnce();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.log.load).not.toHaveBeenCalled();
    expect(mocks.branches.closePopup).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("reports a completed checkout without refreshing the same stores twice", async () => {
    mocks.branches.checkout.mockResolvedValue(true);
    const wrapper = shallowMount(component, { global: { stubs: { VirtualList: false } } });
    const branch = wrapper.get('button[aria-label="feature/ui/button"]');
    await branch.trigger(kind === "pane" ? "dblclick" : "click", { detail: 1 });
    await flushPromises();
    expect(mocks.toast).toHaveBeenCalledWith({ title: "branches.checkedOut feature/ui/button" });
    expect(mocks.log.load).not.toHaveBeenCalled();
    if (kind === "popup") expect(mocks.branches.closePopup).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("renders every nested branch with an unambiguous full-name label", () => {
    const wrapper = shallowMount(component, { global: { stubs: { VirtualList: false } } });
    for (const name of names) {
      expect(
        wrapper.findAll("button").filter((button) => button.attributes("aria-label") === name),
      ).toHaveLength(1);
    }
    expect(wrapper.find("button button").exists()).toBe(false);
    expect(wrapper.text()).toContain("焦点");
    wrapper.unmount();
  });

  it("keeps favorite double-clicks separate from selection and checkout", async () => {
    const wrapper = shallowMount(component, { global: { stubs: { VirtualList: false } } });
    const favorite = wrapper.get('button[aria-label="branches.toggleFavorite feature/ui/button"]');
    expect(favorite.attributes("aria-pressed")).toBe("false");
    await favorite.trigger("click", { detail: 1 });
    await favorite.trigger("click", { detail: 2 });
    await favorite.trigger("dblclick");
    await flushPromises();
    expect(mocks.branches.toggleFavorite).toHaveBeenCalledOnce();
    expect(mocks.branches.toggleFavorite).toHaveBeenCalledWith(mocks.branches.filteredLocal[1]);
    expect(mocks.branches.checkout).not.toHaveBeenCalled();
    expect(mocks.log.setRevisions).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("activates the exact nested branch once for a double-click sequence", async () => {
    const wrapper = shallowMount(component, { global: { stubs: { VirtualList: false } } });
    const branch = wrapper.get('button[aria-label="feature/api/button"]');
    await branch.trigger("click", { detail: 1 });
    await branch.trigger("click", { detail: 2 });
    await branch.trigger("dblclick");
    await flushPromises();
    expect(mocks.branches.checkout).toHaveBeenCalledOnce();
    expect(mocks.branches.checkout).toHaveBeenCalledWith(mocks.branches.filteredLocal[2]);
    if (kind === "pane") expect(mocks.log.applyFilters).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("opens the nested branch context menu without selecting or checking out", async () => {
    const wrapper = shallowMount(component, { global: { stubs: { VirtualList: false } } });
    await wrapper
      .get('button[aria-label="修复/界面/焦点"]')
      .trigger("contextmenu", { clientX: 40, clientY: 50 });
    expect(wrapper.findComponent({ name: "ContextMenuSurface" }).props("open")).toBe(true);
    expect(mocks.branches.checkout).not.toHaveBeenCalled();
    expect(mocks.log.setRevisions).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("keeps full branch names when grouping is disabled or search narrows the result", async () => {
    mocks.settings.settings.git.groupBranchesByDirectory = false;
    const wrapper = shallowMount(component, { global: { stubs: { VirtualList: false } } });
    expect(wrapper.get('button[aria-label="feature/ui/button"]').text()).toContain(
      "feature/ui/button",
    );
    mocks.settings.settings.git.groupBranchesByDirectory = true;
    mocks.branches.filteredLocal = [mocks.branches.filteredLocal[1]];
    await flushPromises();
    expect(wrapper.get('button[aria-label="feature/ui/button"]').text()).toContain("button");
    expect(wrapper.find('button[aria-label="feature/api/button"]').exists()).toBe(false);
    wrapper.unmount();
  });
});

afterEach(() => vi.unstubAllGlobals());

describe.each([
  ["pane", BranchesPane],
  ["popup", BranchesPopup],
] as const)("%s large reference list", (kind, component) => {
  it("bounds mounted rows while scrolling across 6,000 refs, and recovers after filtering", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const entries = (kind: string, prefix: string) =>
      Array.from({ length: 2000 }, (_, i) => ({
        name: `${prefix}${String(i).padStart(4, "0")}`,
        fullName: `refs/${prefix}${i}`,
        kind,
        isHead: false,
        isFavorite: false,
      }));
    mocks.branches.filteredLocal = entries("localBranch", "local/");
    mocks.branches.filteredRemote = entries("remoteBranch", "origin/remote/");
    mocks.branches.filteredTags = entries("tag", "v/");
    mocks.settings.settings.git.groupBranchesByDirectory = false;
    const wrapper = shallowMount(component, { global: { stubs: { VirtualList: false } } });
    const port = wrapper.findComponent(VirtualList).get(".overflow-auto");
    const scroll = async (top: number) => {
      port.element.scrollTop = top;
      await port.trigger("scroll");
      for (const callback of frames.splice(0)) callback(0);
      // VirtualList gates wheel applies (~50ms); advance past the gate.
      await new Promise((resolve) => setTimeout(resolve, 55));
      for (const callback of frames.splice(0)) callback(0);
      await flushPromises();
    };
    expect(wrapper.findAll("button[title]").length).toBeLessThan(40);
    await scroll(3000 * 28);
    expect(wrapper.findAll("button[title]").length).toBeLessThan(40);
    const target = wrapper.get('button[aria-label="origin/remote/1000"]');
    await target.trigger("click", { detail: 1 });
    if (kind === "pane")
      expect(mocks.log.setRevisions).toHaveBeenCalledWith(["origin/remote/1000"]);
    else expect(mocks.branches.checkout.mock.calls.at(-1)?.[0].name).toBe("origin/remote/1000");
    await target.trigger("contextmenu", { clientX: 30, clientY: 40 });
    expect(wrapper.findComponent({ name: "ContextMenuSurface" }).props("open")).toBe(true);
    await scroll(6003 * 28 - 400);
    expect(wrapper.find('button[aria-label="v/1999"]').exists()).toBe(true);
    expect(wrapper.findAll("button[title]").length).toBeLessThan(40);
    mocks.branches.filteredLocal = [mocks.branches.filteredLocal[1999]];
    mocks.branches.filteredRemote = [];
    mocks.branches.filteredTags = [];
    await flushPromises();
    expect(port.element.scrollTop).toBe(0);
    expect(wrapper.find('button[aria-label="local/1999"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
