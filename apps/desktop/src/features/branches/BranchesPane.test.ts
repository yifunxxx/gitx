import { beforeEach, expect, it, vi } from "vitest";
import { shallowMount, flushPromises } from "@vue/test-utils";
import BranchesPane from "./BranchesPane.vue";

const mocks = vi.hoisted(() => ({
  branches: {
    filteredLocal: [{ name: "main", fullName: "refs/heads/main", isHead: true, isFavorite: false }],
    filteredRemote: [],
    filteredTags: [],
    refresh: vi.fn(),
    toggleFavorite: vi.fn(),
    checkout: vi.fn(),
  },
  log: { filters: { revisions: [] }, setRevisions: vi.fn(), applyFilters: vi.fn(), load: vi.fn() },
  toast: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => mocks.branches }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => mocks.log }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => ({}) }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => ({}) }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: vi.fn() }) }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => ({}) }));
vi.mock("@/stores/syncStore", () => ({ useSyncStore: () => ({}) }));
vi.mock("@/actions", () => ({ runAction: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));

beforeEach(() => vi.clearAllMocks());

it("keeps favorite clicks separate from branch selection and checkout", async () => {
  const wrapper = shallowMount(BranchesPane);
  const favorite = wrapper.get('button[aria-label="branches.toggleFavorite"]');
  expect(wrapper.find("button button").exists()).toBe(false);
  await favorite.trigger("click");
  await favorite.trigger("dblclick");
  expect(mocks.branches.toggleFavorite).toHaveBeenCalledTimes(1);
  expect(mocks.log.setRevisions).not.toHaveBeenCalled();
  expect(mocks.branches.checkout).not.toHaveBeenCalled();
  const branch = wrapper.findAll("button").find((b) => b.text() === "main")!;
  await branch.trigger("click");
  expect(mocks.log.setRevisions).toHaveBeenCalledWith(["main"]);
  await branch.trigger("dblclick");
  await flushPromises();
  expect(mocks.branches.checkout).toHaveBeenCalledWith(mocks.branches.filteredLocal[0]);
  wrapper.unmount();
});

it("does not show a successful checkout toast after a multi-root failure", async () => {
  mocks.branches.checkout.mockResolvedValueOnce(false);
  const wrapper = shallowMount(BranchesPane);
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "main")!
    .trigger("dblclick");
  await flushPromises();
  expect(mocks.toast).not.toHaveBeenCalled();
  wrapper.unmount();
});
