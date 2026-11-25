import { beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import FileRootSelector from "./FileRootSelector.vue";
import { owningRepository } from "./fileRepository";
const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  tabs: [] as any[],
  merges: [] as any[],
  busy: false,
  toast: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({ tabs: mocks.tabs }) }));
vi.mock("@/stores/fileOperationsStore", () => ({
  useFileOperationsStore: () => ({ busy: mocks.busy }),
}));
vi.mock("@/stores/conflictsStore", () => ({
  useConflictsStore: () => ({ mergeTabs: mocks.merges, hasUnsavedMergeResult: () => true }),
}));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
beforeEach(() => {
  mocks.tabs = [];
  mocks.merges = [];
  mocks.busy = false;
  mocks.workspace = reactive({
    activeRepoId: "a",
    roots: [
      { id: "a", displayName: "A", worktreeRoot: "C:/p" },
      { id: "b", displayName: "B", worktreeRoot: "C:/p/nested" },
    ],
    setActiveRepo: vi.fn(),
    refreshRoots: vi.fn(),
  });
});
it("identifies the deepest repository and rejects sibling path prefixes", () => {
  expect(owningRepository("C:/p", "nested/file", mocks.workspace.roots)?.id).toBe("b");
  expect(owningRepository("C:/p", "nested-other/file", mocks.workspace.roots)?.id).toBe("a");
});
it("switches roots without replacing the workspace and blocks file or merge drafts", async () => {
  const wrapper = mount(FileRootSelector);
  await wrapper.get("select").setValue("b");
  expect(mocks.workspace.setActiveRepo).toHaveBeenCalledExactlyOnceWith("b");
  mocks.tabs.push({ dirty: true });
  await wrapper.get("select").setValue("b");
  expect(mocks.workspace.setActiveRepo).toHaveBeenCalledTimes(1);
  mocks.tabs.length = 0;
  mocks.merges.push({ id: "merge" });
  await wrapper.get("select").setValue("b");
  await flushPromises();
  expect(mocks.workspace.setActiveRepo).toHaveBeenCalledTimes(1);
  expect(mocks.workspace.refreshRoots).not.toHaveBeenCalled();
  wrapper.unmount();
});
