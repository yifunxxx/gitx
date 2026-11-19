import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import ChangesTree from "./ChangesTree.vue";
import { openChangeDiff } from "./openChangeDiff";
import { useChangesStore } from "@/stores/changesStore";
import { registerVcsActions } from "@/actions/definitions/vcs";
import { getAction, runAction } from "@/actions/registry";

const m = vi.hoisted(() => ({ settings: {} as any, openFileDiff: vi.fn() }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: () => ({
    repoPath: "fixture",
    repoId: "fixture",
    folderPath: "fixture",
    isRepo: true,
    navigationToken: () => 1,
  }),
}));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => m.settings }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({ openFileDiff: m.openFileDiff }) }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({}) }));
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  m.settings = reactive({ settings: { stagingMode: true, git: { changesListMode: "tree" } } });
  m.openFileDiff.mockResolvedValue(undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const changes = useChangesStore();
  changes.snapshot = {
    repoId: "fixture",
    version: 1,
    branch: { head: "main", upstream: null, ahead: null, behind: null, detached: false },
    files: [
      {
        path: "merge.txt",
        origPath: null,
        kind: "unmerged",
        indexStatus: "U",
        worktreeStatus: "U",
      },
    ],
  };
  registerVcsActions();
});
afterEach(() => vi.unstubAllGlobals());

it.each(["click", "dblclick", "Enter", "Ctrl+D"])(
  "routes an actual conflict tree row through read-only diff on %s",
  async (entry) => {
    const wrapper = mount(ChangesTree, {
      props: { onOpenDiff: openChangeDiff },
      global: { stubs: { Tip: { template: "<div><slot /></div>" } } },
    });
    const row = wrapper.findAll('[role="treeitem"][data-path="merge.txt"]')[0]!;
    if (entry === "click" || entry === "dblclick") {
      await row.trigger(entry);
    } else if (entry === "Enter") {
      await row.trigger("click", { ctrlKey: true });
      await wrapper.get('[role="tree"]').trigger("keydown", { key: "Enter" });
    } else {
      await row.trigger("click", { ctrlKey: true });
      expect(getAction("Diff.ShowDiff")!.defaultShortcuts?.win).toContain("ctrl+d");
      await runAction("Diff.ShowDiff", {
        repoIds: ["fixture"],
        selection: {},
        source: "shortcut",
        place: "changes",
        folderPath: "fixture",
      });
    }
    await flushPromises();
    expect(m.openFileDiff).toHaveBeenCalledExactlyOnceWith("merge.txt", "head", "worktree");
  },
);
