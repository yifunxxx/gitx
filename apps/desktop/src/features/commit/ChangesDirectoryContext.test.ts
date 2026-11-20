import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive } from "vue";
import ChangesTree from "./ChangesTree.vue";
import { useChangesStore } from "@/stores/changesStore";
import type { FileChange } from "@/lib/backend";
import { wasContextHandled } from "@/lib/contextMenu";

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
    settings: { stagingMode: false, git: { changesListMode: "tree" } },
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

function change(path: string, kind: FileChange["kind"] = "modified"): FileChange {
  return {
    path,
    origPath: null,
    kind,
    indexStatus: kind === "untracked" ? "?" : "M",
    worktreeStatus: kind === "untracked" ? "?" : "M",
  };
}
function fixture(files = [change("src/nested/a.ts"), change("b.ts"), change("c.ts")]) {
  const store = useChangesStore();
  store.snapshot = {
    repoId: "fixture",
    version: 1,
    branch: { head: "main", upstream: null, ahead: null, behind: null, detached: false },
    files,
  };
  const wrapper = mount(ChangesTree, { attachTo: document.body });
  const tree = wrapper.get('[role="tree"]');
  const folder = (name: string, section = "changelist:default") =>
    wrapper.get(`[role="treeitem"][aria-label="${name}"][data-section="${section}"]`);
  return { wrapper, tree, folder, store };
}

it.each([false, true])(
  "opens a nested directory menu while preserving checks, file selection and collapsed=%s",
  async (collapsed) => {
    const { wrapper, tree, folder, store } = fixture();
    store.selectedPaths = ["b.ts", "c.ts"];
    store.selectedSection = "changelist:default";
    store.checkedPaths = ["src/nested/a.ts", "b.ts"];
    await nextTick();
    if (collapsed) await folder("nested").get("button").trigger("click");
    const nested = folder("nested");
    const event = new MouseEvent("contextmenu", {
      clientX: 42,
      clientY: 80,
      bubbles: true,
      cancelable: true,
    });
    nested.element.dispatchEvent(event);
    await nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(wasContextHandled(event)).toBe(true);
    expect(wrapper.emitted("context")).toEqual([
      [
        {
          path: "src/nested",
          section: "changelist:default",
          x: 42,
          y: 80,
          header: false,
          directory: true,
        },
      ],
    ]);
    expect(nested.attributes("aria-expanded")).toBe(String(!collapsed));
    expect(tree.attributes("aria-activedescendant")).toBe(nested.attributes("id"));
    expect(document.activeElement).toBe(tree.element);
    expect(store.selectedPaths).toEqual(["b.ts", "c.ts"]);
    expect(store.selectedSection).toBe("changelist:default");
    expect(store.checkedPaths).toEqual(["src/nested/a.ts", "b.ts"]);
    expect(wrapper.emitted("openDiff")).toBeUndefined();
  },
);

it.each([{ key: "ContextMenu" }, { key: "F10", shiftKey: true }])(
  "opens a focused directory with $key",
  async (options) => {
    const { wrapper, tree, folder, store } = fixture();
    store.selectedPaths = ["b.ts", "c.ts"];
    store.selectedSection = "changelist:default";
    await tree.trigger("keydown", { key: "ArrowRight" });
    const src = folder("src");
    vi.spyOn(src.element, "getBoundingClientRect").mockReturnValue({
      left: 50,
      bottom: 130,
    } as DOMRect);
    const event = new KeyboardEvent("keydown", { ...options, bubbles: true, cancelable: true });
    tree.element.dispatchEvent(event);
    await nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.emitted("context")).toEqual([
      [
        {
          path: "src",
          section: "changelist:default",
          x: 70,
          y: 130,
          header: false,
          directory: true,
        },
      ],
    ]);
    expect(src.attributes("aria-expanded")).toBe("true");
    expect(store.selectedPaths).toEqual(["b.ts", "c.ts"]);
    expect(wrapper.emitted("openDiff")).toBeUndefined();
  },
);

it.each(["tree", "flat"])(
  "treats an untracked directory leaf as a directory in %s mode",
  async (mode) => {
    mocks.settings.settings.git.changesListMode = mode;
    const { wrapper, tree, store } = fixture([change("new/cache/", "untracked")]);
    store.selectedPaths = ["old.ts"];
    store.selectedSection = "changelist:default";
    const leaf = wrapper.get('[data-path="new/cache/"]');
    await leaf.trigger("contextmenu", { clientX: 20, clientY: 40 });
    expect(wrapper.emitted("context")?.at(-1)).toEqual([
      {
        path: "new/cache/",
        section: "unversioned",
        x: 20,
        y: 40,
        header: false,
        directory: true,
      },
    ]);
    await tree.trigger("keydown", { key: "ContextMenu" });
    expect(wrapper.emitted("context")).toHaveLength(2);
    expect(wrapper.emitted("context")?.at(-1)?.[0]).toMatchObject({
      path: "new/cache/",
      section: "unversioned",
      header: false,
      directory: true,
    });
    expect(store.selectedPaths).toEqual(["old.ts"]);
    expect(store.selectedSection).toBe("changelist:default");
    expect(wrapper.emitted("openDiff")).toBeUndefined();
  },
);

it("identifies the correct staging section for a directory without replacing the selection", async () => {
  mocks.settings.settings.stagingMode = true;
  const { wrapper, folder, store } = fixture();
  store.selectedPaths = ["b.ts", "c.ts"];
  store.selectedSection = "staged";
  await folder("src", "unstaged").trigger("contextmenu");
  expect(wrapper.emitted("context")?.[0]?.[0]).toMatchObject({
    path: "src",
    section: "unstaged",
    header: false,
    directory: true,
  });
  expect(store.selectedPaths).toEqual(["b.ts", "c.ts"]);
  expect(store.selectedSection).toBe("staged");
});

it("ignores modified, composing and repeated context keys on directories", async () => {
  const { wrapper, tree } = fixture();
  await tree.trigger("keydown", { key: "ArrowRight" });
  const cases = [
    { key: "F10" },
    { key: "F10", shiftKey: true, ctrlKey: true },
    { key: "ContextMenu", shiftKey: true },
    ...["ctrlKey", "metaKey", "altKey", "isComposing", "repeat"].map((modifier) => ({
      key: "ContextMenu",
      [modifier]: true,
    })),
  ];
  for (const options of cases) {
    const event = new KeyboardEvent("keydown", { ...options, bubbles: true, cancelable: true });
    tree.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(wrapper.emitted("context")).toBeUndefined();
  expect(wrapper.emitted("openDiff")).toBeUndefined();
});
