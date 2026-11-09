import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { reactive } from "vue";
import BranchesPane from "./BranchesPane.vue";
import BranchesPopup from "./BranchesPopup.vue";

const mocks = vi.hoisted(() => ({ branches: {} as any, settings: {} as any, log: {} as any }));
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
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));

const names = ["main", "feature/ui/button", "feature/api/button", "修复/界面/焦点"];
beforeEach(() => {
  vi.clearAllMocks();
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

describe.each([
  ["pane", BranchesPane],
  ["popup", BranchesPopup],
] as const)("%s local branches", (kind, component) => {
  it("renders every nested branch with an unambiguous full-name label", () => {
    const wrapper = shallowMount(component);
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
    const wrapper = shallowMount(component);
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
    const wrapper = shallowMount(component);
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
    const wrapper = shallowMount(component);
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
    const wrapper = shallowMount(component);
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
