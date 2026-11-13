import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import ChangesTree from "./ChangesTree.vue";
import { useChangesStore, type ChangesSection } from "@/stores/changesStore";

const mocks = vi.hoisted(() => ({ workspace: {} as any, settings: {} as any }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({}) }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

enableAutoUnmount(afterEach);
beforeEach(() => {
  setActivePinia(createPinia());
  mocks.workspace = reactive({ repoPath: "fixture" });
  mocks.settings = reactive({
    settings: { stagingMode: true, git: { changesListMode: "tree" } },
    emptySettings: () => ({ stagingMode: true, git: { changesListMode: "tree" } }),
    save: vi.fn(async (next: unknown) => {
      mocks.settings.settings = next;
    }),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  useChangesStore().snapshot = {
    repoId: "fixture",
    version: 1,
    branch: { head: "main", upstream: null, ahead: null, behind: null, detached: false },
    files: ["a.txt", "b.txt"].map((path) => ({
      path,
      origPath: null,
      indexStatus: "M",
      worktreeStatus: "M",
      kind: "modified",
    })),
  };
});
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const wrapper = mount(ChangesTree, {
    attachTo: document.body,
    global: { stubs: { Tip: { template: "<div><slot /></div>" } } },
  });
  const rows = wrapper.findAll('[role="treeitem"][data-path]');
  expect(rows.map((row) => row.text())).toEqual(["a.txt", "b.txt", "a.txt", "b.txt"]);
  return { wrapper, rows, store: useChangesStore() };
}

describe("Changes shortcuts", () => {
  it("opens the focused file with plain F4", async () => {
    const { wrapper, rows } = fixture();
    await rows[0]!.trigger("click");
    const event = new KeyboardEvent("keydown", { key: "F4", bubbles: true, cancelable: true });
    wrapper.get('[role="tree"]').element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.emitted("openFile")).toEqual([["a.txt"]]);
  });

  it.each(["altKey", "ctrlKey", "metaKey", "shiftKey", "isComposing", "repeat"])(
    "leaves F4 with %s untouched",
    async (flag) => {
      const { wrapper, rows } = fixture();
      await rows[0]!.trigger("click");
      const event = new KeyboardEvent("keydown", {
        key: "F4",
        bubbles: true,
        cancelable: true,
        [flag]: true,
      });
      wrapper.get('[role="tree"]').element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(wrapper.emitted("openFile")).toBeUndefined();
    },
  );
});

describe("Changes selection ownership", () => {
  it.each(["ctrlKey", "metaKey"])(
    "toggles within one section and starts a new selection across sections with %s",
    async (modifier) => {
      const { wrapper, rows, store } = fixture();
      await rows[0]!.trigger("click");
      await rows[1]!.trigger("click", { [modifier]: true });
      expect(store.selectedPaths).toEqual(["a.txt", "b.txt"]);
      expect(store.selectedSection).toBe("staged");
      await rows[0]!.trigger("click", { [modifier]: true });
      expect(store.selectedPaths).toEqual(["b.txt"]);
      await rows[2]!.trigger("click", { [modifier]: true });
      expect(store.selectedPaths).toEqual(["a.txt"]);
      expect(store.selectedSection).toBe("unstaged");
      await rows[0]!.trigger("click", { [modifier]: true });
      expect(store.selectedPaths).toEqual(["a.txt"]);
      expect(store.selectedSection).toBe("staged");
      // Multi-selection does not repeatedly replace the visible Diff.
      expect(wrapper.emitted("openDiff")).toEqual([["a.txt", "staged"]]);
    },
  );

  it("right-clicks the correct copy of a path present in both staging sections", async () => {
    const { wrapper, rows, store } = fixture();
    await rows[0]!.trigger("click");
    await rows[1]!.trigger("click", { ctrlKey: true });
    await rows[2]!.trigger("contextmenu", { clientX: 42, clientY: 80 });
    expect(store.selectedPaths).toEqual(["a.txt"]);
    expect(store.selectedSection).toBe("unstaged");
    expect(wrapper.emitted("context")).toEqual([
      [{ path: "a.txt", section: "unstaged", x: 42, y: 80, header: false }],
    ]);
    expect(rows[2]!.classes()).toContain("bg-selection");
    expect(rows[0]!.classes()).not.toContain("bg-selection");
    expect(rows[1]!.classes()).not.toContain("bg-selection");
  });

  it("preserves a same-section multi-selection on right-click and replaces it for an unselected row", async () => {
    const { rows, store } = fixture();
    await rows[0]!.trigger("click");
    await rows[1]!.trigger("click", { ctrlKey: true });
    await rows[0]!.trigger("contextmenu");
    expect(store.selectedPaths).toEqual(["a.txt", "b.txt"]);
    expect(store.selectedSection).toBe("staged");
    await rows[1]!.trigger("click", { ctrlKey: true });
    await rows[1]!.trigger("contextmenu");
    expect(store.selectedPaths).toEqual(["b.txt"]);
  });

  it.each<ChangesSection>(["unversioned", "ignored", "changelist:other"])(
    "does not carry a staged selection into %s",
    (section) => {
      const store = useChangesStore();
      store.select("staged.txt", "staged");
      store.select("target.txt", section, true);
      expect(store.selectedPaths).toEqual(["target.txt"]);
      expect(store.selectedSection).toBe(section);
    },
  );
});
