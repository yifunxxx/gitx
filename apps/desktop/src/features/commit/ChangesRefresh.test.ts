import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive } from "vue";
import type { StatusSnapshot } from "@/lib/backend";
import { useChangesStore } from "@/stores/changesStore";
import VirtualList from "@/components/common/VirtualList.vue";
import ChangesTree from "./ChangesTree.vue";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  settings: {} as any,
  backend: { statusGet: vi.fn(), changelistList: vi.fn() },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.workspace = reactive({
    repoPath: "fixture",
    repoId: "fixture",
    isRepo: true,
    navigationToken: () => 1,
    setBranch: vi.fn(),
  });
  mocks.settings = reactive({ settings: { stagingMode: true, git: { changesListMode: "tree" } } });
  mocks.backend.changelistList.mockResolvedValue({
    lists: [{ id: "default", name: "Changes", comment: "", active: true }],
    assignments: [],
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function snapshot(version: number, behind = 0, paths = ["src/a.ts", "src/z.ts"]): StatusSnapshot {
  return {
    repoId: "fixture",
    version,
    branch: { head: "main", upstream: "origin/main", ahead: 0, behind, detached: false },
    files: paths.map((path) => ({
      path,
      origPath: null,
      indexStatus: "M",
      worktreeStatus: "M",
      kind: "modified",
    })),
  };
}

it.each([
  { staging: true, mode: "tree" },
  { staging: true, mode: "flat" },
  { staging: false, mode: "tree" },
  { staging: false, mode: "flat" },
])(
  "retains unchanged rows and selection through branch refresh in $mode, staging=$staging",
  async ({ staging, mode }) => {
    mocks.settings.settings.stagingMode = staging;
    mocks.settings.settings.git.changesListMode = mode;
    mocks.backend.statusGet
      .mockResolvedValueOnce(snapshot(1))
      .mockResolvedValueOnce(snapshot(2, 1))
      .mockResolvedValueOnce(snapshot(3, 1, ["src/a.ts", "src/new.ts"]));
    const store = useChangesStore();
    await store.refresh();
    const wrapper = mount(ChangesTree);
    const tree = wrapper.get('[role="tree"]');
    const section = staging ? "staged" : "changelist:default";
    await wrapper.get(`[data-path="src/a.ts"][data-section="${section}"]`).trigger("click");
    if (!staging) store.checkedPaths = ["src/a.ts"];
    await nextTick();
    const list = wrapper.getComponent(VirtualList);
    const rowItems = () => (list.props() as { items: unknown[] }).items;
    const rows = rowItems();
    const active = tree.attributes("aria-activedescendant");
    await store.refresh(true);
    await nextTick();
    expect(rowItems()).toBe(rows);
    expect(tree.attributes("aria-activedescendant")).toBe(active);
    expect(store.selectedPaths).toEqual(["src/a.ts"]);
    expect(
      wrapper.get(`[data-path="src/a.ts"][data-section="${section}"]`).attributes("aria-selected"),
    ).toBe("true");
    if (!staging) expect(wrapper.get('[aria-level="1"]').attributes("aria-checked")).toBe("mixed");
    await store.refresh(true);
    await nextTick();
    expect(rowItems()).not.toBe(rows);
    expect(wrapper.find('[data-path="src/z.ts"]').exists()).toBe(false);
    expect(wrapper.find('[data-path="src/new.ts"]').exists()).toBe(true);
    expect(store.selectedPaths).toEqual(["src/a.ts"]);
    await tree.trigger("keydown", { key: "End" });
    await tree.trigger("keydown", { key: "ArrowUp" });
    expect(store.selectedPaths).toEqual(["src/new.ts"]);
  },
);

it.each(["flat", "tree"])(
  "preserves the visible file when a background refresh inserts a preceding file in %s mode",
  async (mode) => {
    mocks.settings.settings.git.changesListMode = mode;
    const paths = Array.from(
      { length: 100 },
      (_, index) => `src/file-${String(index).padStart(3, "0")}.ts`,
    );
    mocks.backend.statusGet
      .mockResolvedValueOnce(snapshot(1, 0, paths))
      .mockResolvedValueOnce(snapshot(2, 0, ["src/added.ts", ...paths]));
    const store = useChangesStore();
    await store.refresh();
    const wrapper = mount(ChangesTree);
    const list = wrapper.getComponent(VirtualList);
    const anchorIndex = () =>
      (
        list.props() as { items: { section: string; node?: { file?: { path: string } } }[] }
      ).items.findIndex(
        (row) => row.section === "staged" && row.node?.file?.path === "src/file-050.ts",
      );
    const before = anchorIndex();
    expect(before).toBeGreaterThan(0);
    const port = list.get(".overflow-auto").element as HTMLElement;
    const pixelOffset = 7;
    port.scrollTop = before * 22 + pixelOffset;
    await store.refresh(true);
    await flushPromises();
    expect(anchorIndex()).toBe(before + 1);
    expect(port.scrollTop).toBe(anchorIndex() * 22 + pixelOffset);
  },
);
