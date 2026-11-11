import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive } from "vue";
import ChangesTree from "./ChangesTree.vue";
import { useChangesStore } from "@/stores/changesStore";

const mocks = vi.hoisted(() => ({ workspace: {} as any, settings: {} as any }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({}) }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

enableAutoUnmount(afterEach);
beforeEach(() => {
  setActivePinia(createPinia());
  mocks.workspace = reactive({ repoPath: "fixture" });
  mocks.settings = reactive({ settings: { stagingMode: true } });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function setFiles(paths: string[]) {
  useChangesStore().snapshot = {
    repoId: "fixture",
    version: 1,
    branch: { head: "main", upstream: null, ahead: null, behind: null, detached: false },
    files: paths.map((path) => ({
      path,
      origPath: null,
      indexStatus: "M",
      worktreeStatus: "M",
      kind: "modified",
    })),
  };
}

function fixture(paths = ["src/a.txt", "src/b.txt", "z.txt"]) {
  setFiles(paths);
  const wrapper = mount(ChangesTree, { attachTo: document.body });
  const tree = wrapper.get('[role="tree"]');
  (tree.element as HTMLElement).focus();
  const active = () => document.getElementById(tree.attributes("aria-activedescendant") ?? "");
  const key = async (key: string, modifiers: Record<string, boolean> = {}) => {
    await tree.trigger("keydown", { key, ...modifiers });
    await nextTick();
  };
  const file = (path: string, section = "staged") =>
    wrapper.get(`[data-path="${path}"][data-section="${section}"]`);
  return { wrapper, tree, active, key, file, store: useChangesStore() };
}

describe("Changes tree keyboard navigation", () => {
  it("shows partial commit checks immediately, including when the tree mounts again", async () => {
    mocks.settings.settings.stagingMode = false;
    useChangesStore().checkedPaths = ["a.txt"];
    const { wrapper, tree } = fixture(["a.txt", "b.txt"]);
    await nextTick();
    const header = wrapper.get('[role="treeitem"][aria-level="1"]');
    expect(header.attributes("aria-label")).toBe("Changes (2)");
    expect(wrapper.get('[data-path="a.txt"]').attributes("aria-label")).toBe("a.txt");
    expect(header.attributes("aria-checked")).toBe("mixed");
    expect((header.get("input").element as HTMLInputElement).indeterminate).toBe(true);
    expect(document.activeElement).toBe(tree.element);
  });
  it("drops a virtualized active descendant while scrolling and reveals it on keyboard navigation", async () => {
    const { wrapper, tree, active, key } = fixture(
      Array.from({ length: 500 }, (_, i) => `f${i}.txt`),
    );
    const port = wrapper.get(".overflow-auto").element as HTMLElement;
    expect(active()).not.toBeNull();
    port.scrollTop = 6000;
    port.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(tree.attributes("aria-activedescendant")).toBeUndefined());
    await key("Home");
    expect(active()?.textContent).toContain("Staged");
    expect(port.scrollTop).toBe(0);
    expect(port.tabIndex).toBe(-1);
  });

  it("activates the focused file after Ctrl navigation or removal without opening the old target", async () => {
    const { wrapper, file, active, key, store } = fixture(["a.txt", "b.txt", "c.txt"]);
    await file("a.txt").trigger("click");
    await key("ArrowDown", { ctrlKey: true });
    await key("Enter");
    expect(store.selectedPaths).toEqual(["b.txt"]);
    expect(wrapper.emitted("openDiff")?.at(-1)).toEqual(["b.txt", "staged"]);
    setFiles(["a.txt", "c.txt"]);
    await nextTick();
    expect(active()?.getAttribute("data-path")).toBe("c.txt");
    await key("Enter");
    expect(store.selectedPaths).toEqual(["c.txt"]);
    expect(wrapper.emitted("openDiff")?.at(-1)).toEqual(["c.txt", "staged"]);
  });

  it("has one Tab entry and navigates sections, folders and files", async () => {
    const { wrapper, tree, active, key, store } = fixture();
    expect(wrapper.findAll('[tabindex="0"]')).toHaveLength(1);
    expect(active()?.textContent).toContain("Staged");
    await key("ArrowRight");
    expect(active()?.textContent).toBe("src");
    expect(active()?.getAttribute("aria-level")).toBe("2");
    await key("ArrowLeft");
    expect(active()?.getAttribute("aria-expanded")).toBe("false");
    expect(wrapper.find('[data-path="src/a.txt"][data-section="staged"]').exists()).toBe(false);
    await key("ArrowRight");
    await key("ArrowRight");
    expect(store.selectedPaths).toEqual(["src/a.txt"]);
    expect(active()?.getAttribute("aria-level")).toBe("3");
    expect(active()?.getAttribute("aria-setsize")).toBe("2");
    await key("ArrowDown");
    expect(store.selectedPaths).toEqual(["src/b.txt"]);
    await key("ArrowLeft");
    expect(active()?.textContent).toBe("src");
    await key("Home");
    expect(active()?.textContent).toContain("Staged");
    await key("Enter");
    expect(active()?.getAttribute("aria-expanded")).toBe("false");
    await key("ArrowDown");
    expect(active()?.textContent).toContain("Unstaged");
    expect(document.activeElement).toBe(tree.element);
  });

  it("keeps range selection within one section, including Shift-click", async () => {
    const { file, key, store } = fixture(["a.txt", "b.txt", "c.txt"]);
    await file("a.txt").trigger("click");
    await key("ArrowDown", { shiftKey: true });
    expect(store.selectedPaths).toEqual(["a.txt", "b.txt"]);
    await file("c.txt").trigger("click", { shiftKey: true });
    expect(store.selectedPaths).toEqual(["a.txt", "b.txt", "c.txt"]);
    await key("ArrowDown", { shiftKey: true }); // Unstaged header
    await key("ArrowDown", { shiftKey: true });
    expect(store.selectedPaths).toEqual(["a.txt"]);
    expect(store.selectedSection).toBe("unstaged");
    await key("ArrowDown", { shiftKey: true });
    expect(store.selectedPaths).toEqual(["a.txt", "b.txt"]);
  });

  it("moves focus with Ctrl without replacing selection or opening another Diff", async () => {
    const { wrapper, file, key, active, store } = fixture(["a.txt", "b.txt"]);
    await file("a.txt").trigger("click");
    await key("ArrowDown", { ctrlKey: true });
    expect(active()?.getAttribute("data-path")).toBe("b.txt");
    expect(store.selectedPaths).toEqual(["a.txt"]);
    expect(wrapper.emitted("openDiff")).toEqual([["a.txt", "staged"]]);
    await key(" ", { ctrlKey: true });
    expect(store.selectedPaths).toEqual(["a.txt", "b.txt"]);
  });

  it("opens Diff with Enter and a menu with exact Shift+F10, preserving multi-selection", async () => {
    const { wrapper, file, key, store } = fixture(["a.txt", "b.txt"]);
    await file("a.txt").trigger("click");
    await file("b.txt").trigger("click", { ctrlKey: true });
    await key("F10", { shiftKey: true });
    expect(store.selectedPaths).toEqual(["a.txt", "b.txt"]);
    expect(wrapper.emitted("context")).toHaveLength(1);
    expect(wrapper.emitted("context")![0]![0]).toMatchObject({ path: "b.txt", section: "staged" });
    await key("F10", { shiftKey: true, repeat: true });
    await key("ContextMenu", { ctrlKey: true });
    await key("Enter", { altKey: true });
    expect(wrapper.emitted("context")).toHaveLength(1);
    await key("Enter");
    expect(wrapper.emitted("openDiff")?.at(-1)).toEqual(["b.txt", "staged"]);
  });

  it("uses Space for changelist checks without double-toggling a nested input", async () => {
    mocks.settings.settings.stagingMode = false;
    const { wrapper, file, key, store } = fixture(["a.txt", "b.txt"]);
    await key(" ");
    expect(store.checkedPaths).toEqual(["a.txt", "b.txt"]);
    await file("a.txt", "changelist:default").trigger("click");
    await key(" ");
    expect(store.checkedPaths).toEqual(["b.txt"]);
    const checkbox = file("a.txt", "changelist:default").get("input");
    await checkbox.trigger("keydown", { key: " " });
    expect(store.checkedPaths).toEqual(["b.txt"]);
    await checkbox.setValue(true);
    expect(store.checkedPaths).toEqual(["b.txt", "a.txt"]);
    expect(wrapper.findAll("input").every((input) => input.attributes("tabindex") === "-1")).toBe(
      true,
    );
  });

  it("never changes commit checks in staging mode and ignores composing input", async () => {
    const { file, key, store, active } = fixture(["a.txt", "b.txt"]);
    await file("a.txt").trigger("click");
    await key(" ");
    expect(store.checkedPaths).toEqual([]);
    await key("ArrowDown", { isComposing: true });
    expect(active()?.getAttribute("data-path")).toBe("a.txt");
  });

  it("navigates to offscreen rows and pages with bounded DOM at 5,000 files", async () => {
    const { wrapper, tree, active, key, store } = fixture(
      Array.from({ length: 5000 }, (_, i) => `f${String(i).padStart(4, "0")}.txt`),
    );
    await key("End");
    expect(active()?.textContent).toContain("changelist.unversioned");
    await key("ArrowUp");
    expect(store.selectedPaths).toEqual(["f4999.txt"]);
    expect(store.selectedSection).toBe("unstaged");
    expect(active()?.getAttribute("aria-posinset")).toBe("5000");
    await key("PageUp");
    expect(store.selectedPaths).toEqual(["f4981.txt"]);
    await key("PageDown");
    expect(store.selectedPaths).toEqual(["f4999.txt"]);
    expect(wrapper.findAll('[role="treeitem"]').length).toBeLessThan(65);
    expect(document.activeElement).toBe(tree.element);
  });

  it("preserves active identity on insertion and clears it with expansion on repository change", async () => {
    const { file, active, key } = fixture(["src/a.txt", "z.txt"]);
    await file("z.txt").trigger("click");
    setFiles(["new.txt", "src/a.txt", "z.txt"]);
    await nextTick();
    expect(active()?.getAttribute("data-path")).toBe("z.txt");
    await key("Home");
    await key("ArrowRight");
    await key("ArrowLeft");
    expect(active()?.getAttribute("aria-expanded")).toBe("false");
    mocks.workspace.repoPath = "another";
    setFiles(["src/a.txt", "z.txt"]);
    await nextTick();
    await key("ArrowRight");
    expect(active()?.textContent).toBe("src");
    expect(active()?.getAttribute("aria-expanded")).toBe("true");
  });
});
