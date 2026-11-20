import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, reactive } from "vue";
import ChangesTree from "./ChangesTree.vue";
import { useChangesStore } from "@/stores/changesStore";
import type { FileChange } from "@/lib/backend";

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
    settings: { stagingMode: false, showIgnoredFiles: true, git: { changesListMode: "tree" } },
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
    indexStatus: kind === "untracked" ? "?" : kind === "ignored" ? "!" : "M",
    worktreeStatus: kind === "untracked" ? "?" : kind === "ignored" ? "!" : "M",
  };
}
function setFiles(files: FileChange[]) {
  useChangesStore().snapshot = {
    repoId: "fixture",
    version: 1,
    branch: { head: "main", upstream: null, ahead: null, behind: null, detached: false },
    files,
  };
}
function fixture(
  paths = ["src/a.ts", "src/nested/b.ts", "src/nested/c.ts", "src-other/d.ts", "z.txt"],
) {
  setFiles(paths.map((path) => change(path)));
  const wrapper = mount(ChangesTree, { attachTo: document.body });
  const folder = (name: string, section = "changelist:default") =>
    wrapper.get(`[role="treeitem"][aria-label="${name}"][data-section="${section}"]`);
  return { wrapper, folder, store: useChangesStore() };
}

it("checks all descendants without selecting a sibling prefix or changing file selection", async () => {
  const { wrapper, folder, store } = fixture();
  store.selectedPaths = ["z.txt"];
  store.selectedSection = "changelist:default";
  store.checkedPaths = ["z.txt"];
  await nextTick();
  const src = folder("src");
  expect(src.attributes("aria-checked")).toBe("false");
  await src.get("input").setValue(true);
  expect([...store.checkedPaths].sort()).toEqual([
    "src/a.ts",
    "src/nested/b.ts",
    "src/nested/c.ts",
    "z.txt",
  ]);
  expect(src.attributes("aria-checked")).toBe("true");
  expect(folder("nested").attributes("aria-checked")).toBe("true");
  expect(folder("src-other").attributes("aria-checked")).toBe("false");
  expect(src.attributes("aria-expanded")).toBe("true");
  expect(store.selectedPaths).toEqual(["z.txt"]);
  expect(wrapper.emitted("openDiff")).toBeUndefined();
  await src.get("input").setValue(false);
  expect(store.checkedPaths).toEqual(["z.txt"]);
});

it("shows nested mixed state and turns a partial directory into all selected", async () => {
  const { wrapper, folder, store } = fixture();
  store.checkedPaths = ["src/nested/b.ts"];
  await nextTick();
  for (const name of ["src", "nested"]) {
    expect(folder(name).attributes("aria-checked")).toBe("mixed");
    expect(folder(name).get<HTMLInputElement>("input").element.indeterminate).toBe(true);
  }
  await folder("nested").get("input").setValue(true);
  expect([...store.checkedPaths].sort()).toEqual(["src/nested/b.ts", "src/nested/c.ts"]);
  expect(folder("nested").attributes("aria-checked")).toBe("true");
  expect(folder("src").attributes("aria-checked")).toBe("mixed");
  await wrapper.get('[data-path="src/a.ts"]').get("input").setValue(true);
  expect(folder("src").attributes("aria-checked")).toBe("true");
});

it("checks collapsed descendants with Space and retains expansion after toggling", async () => {
  const { wrapper, folder, store } = fixture();
  await folder("src").get("button").trigger("click");
  expect(folder("src").attributes("aria-expanded")).toBe("false");
  expect(wrapper.find('[data-path="src/a.ts"]').exists()).toBe(false);
  await wrapper.get('[role="tree"]').trigger("keydown", { key: " " });
  expect([...store.checkedPaths].sort()).toEqual([
    "src/a.ts",
    "src/nested/b.ts",
    "src/nested/c.ts",
  ]);
  expect(folder("src").attributes("aria-checked")).toBe("true");
  expect(folder("src").attributes("aria-expanded")).toBe("false");
  await wrapper.get('[role="tree"]').trigger("keydown", { key: " " });
  expect(store.checkedPaths).toEqual([]);
});

it("keeps the same directory in different changelists isolated", async () => {
  const { folder, store } = fixture(["src/a.ts", "src/b.ts"]);
  store.changelists = {
    lists: [
      { id: "default", name: "Changes", comment: "", active: true },
      { id: "other", name: "Other", comment: "", active: false },
    ],
    assignments: [{ path: "src/b.ts", listId: "other" }],
  };
  await nextTick();
  await folder("src", "changelist:default").get("input").setValue(true);
  expect(store.checkedPaths).toEqual(["src/a.ts"]);
  expect(folder("src", "changelist:other").attributes("aria-checked")).toBe("false");
  await folder("src", "changelist:other").get("input").setValue(true);
  expect([...store.checkedPaths].sort()).toEqual(["src/a.ts", "src/b.ts"]);
});

it("updates a collapsed directory's state when background changes add or remove children", async () => {
  const { folder, store } = fixture(["src/a.ts"]);
  await folder("src").get("input").setValue(true);
  await folder("src").get("button").trigger("click");
  setFiles([change("src/a.ts"), change("src/new.ts")]);
  await nextTick();
  expect(folder("src").attributes("aria-checked")).toBe("mixed");
  await folder("src").get("input").setValue(true);
  expect([...store.checkedPaths].sort()).toEqual(["src/a.ts", "src/new.ts"]);
  setFiles([change("src/new.ts")]);
  await nextTick();
  expect(folder("src").attributes("aria-checked")).toBe("true");
});

it("includes unversioned directory leaves and preserves the ignored and staging rules", async () => {
  const { wrapper, folder, store } = fixture();
  setFiles([
    change("new/a.txt", "untracked"),
    change("new/cache/", "untracked"),
    change("ignored/a.txt", "ignored"),
  ]);
  await nextTick();
  await folder("new", "unversioned").get("input").setValue(true);
  expect([...store.checkedPaths].sort()).toEqual(["new/a.txt", "new/cache/"]);
  expect(folder("ignored", "ignored").find("input").exists()).toBe(false);
  expect(folder("ignored", "ignored").attributes("aria-checked")).toBeUndefined();
  mocks.settings.settings.stagingMode = true;
  await nextTick();
  expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);
});

it("does not scan offscreen descendants while scrolling checked directories", async () => {
  const { wrapper, store } = fixture(
    Array.from({ length: 2000 }, (_, i) => `src/f${String(i).padStart(4, "0")}.txt`),
  );
  const tail = store.snapshot!.files.at(-1)!;
  const path = tail.path;
  let reads = 0;
  Object.defineProperty(tail, "path", {
    get() {
      reads++;
      return path;
    },
  });
  store.checkedPaths = [path];
  await nextTick();
  expect(wrapper.get('[role="treeitem"][aria-label="src"]').attributes("aria-checked")).toBe(
    "mixed",
  );
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  const port = wrapper.get(".overflow-auto").element;
  reads = 0;
  for (let i = 1; i <= 8; i++) {
    port.scrollTop = i * 22;
    port.dispatchEvent(new Event("scroll"));
    frames.splice(0).forEach((callback) => callback(0));
    await nextTick();
  }
  expect(reads).toBe(0);
  expect(wrapper.findAll('[role="treeitem"]').length).toBeLessThan(65);
});
