import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { defineComponent, h, reactive, watch, watchEffect } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import type { FsEntry } from "@/lib/backend";
import { useFileTreeStore, type FileTreeRow } from "./fileTreeStore";
import VirtualList from "@/components/common/VirtualList.vue";

const mocks = vi.hoisted(() => ({ fsReadDir: vi.fn(), workspace: {} as any, settings: {} as any }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
const file = (path: string): FsEntry => ({ path, name: path.split("/").at(-1)!, kind: "file" });
const dir = (path: string): FsEntry => ({ ...file(path), kind: "directory" });
function deferred() {
  let resolve!: (entries: FsEntry[]) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<FsEntry[]>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let pinia: ReturnType<typeof createPinia>;
const stops: (() => void)[] = [];
let contents: Record<string, FsEntry[]>;
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  mocks.workspace = reactive({
    folderPath: "C:/project",
    token: 1,
    appliedOpenToken() {
      return this.token;
    },
  });
  mocks.settings = reactive({ settings: { compactFileTree: false } });
  contents = { "": [dir("src"), file("readme")], src: [file("src/a"), file("src/b")] };
  // A fresh IPC payload on every read, including when the filesystem is unchanged.
  mocks.fsReadDir.mockImplementation(async ({ dir: path }) =>
    contents[path]!.map((entry) => ({ ...entry })),
  );
});
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  disposePinia(pinia);
});
async function opened() {
  const store = useFileTreeStore();
  await store.loadRoot();
  await store.expand("src");
  return store;
}
it("keeps the row model and selection when refreshed directory contents are unchanged", async () => {
  const store = await opened();
  store.select("src/a");
  store.select("readme", { toggle: true });
  const rows = store.rows;
  const selection = store.selectedPaths;
  const published = vi.fn();
  stops.push(watch(() => store.rows, published, { flush: "sync" }));
  await store.refreshExpanded();
  expect(store.rows).toBe(rows);
  expect(published).not.toHaveBeenCalled();
  expect(store.selectedPaths).toBe(selection);
});
it("keeps a compact-name filter and selected directory during and after an unchanged refresh", async () => {
  mocks.settings.settings.compactFileTree = true;
  contents = { "": [dir("src")], src: [dir("src/one")], "src/one": [] };
  const store = await opened();
  store.filter = "src/one";
  store.select("src/one");
  const rows = store.rows;
  const root = deferred();
  mocks.fsReadDir.mockReturnValueOnce(root.promise);
  const refreshing = store.refreshExpanded();
  try {
    expect(store.rows).toBe(rows);
    expect(store.selectedPaths).toEqual(["src/one"]);
  } finally {
    root.resolve(contents[""]!);
    await refreshing;
  }
  expect(store.selectedPaths).toEqual(["src/one"]);
});
it("publishes a real addition without replacing a surviving selection", async () => {
  const store = await opened();
  store.select("src/a");
  const selection = store.selectedPaths;
  const rows = store.rows;
  contents.src = [...contents.src!, file("src/c")];
  await store.refreshExpanded();
  expect(store.rows).not.toBe(rows);
  expect(store.rows.map((row) => row.path)).toContain("src/c");
  expect(store.selectedPaths).toBe(selection);
});
it("continues to expose reactive child loading and retry errors with stable rows", async () => {
  const store = await opened();
  const snapshots: { loading: boolean; error: string | null }[] = [];
  stops.push(
    watchEffect(
      () => {
        const row = store.rows[0]!;
        snapshots.push({ loading: row.loading, error: row.error });
      },
      { flush: "sync" },
    ),
  );
  const child = deferred();
  mocks.fsReadDir.mockImplementation(({ dir: path }) =>
    path === "" ? Promise.resolve(contents[""]) : child.promise,
  );
  const refreshing = store.refreshExpanded();
  await flushPromises();
  expect(snapshots.at(-1)).toEqual({ loading: true, error: null });
  child.reject(new Error("read denied"));
  await refreshing;
  expect(snapshots.at(-1)).toEqual({ loading: false, error: "read denied" });
  mocks.fsReadDir.mockImplementation(async ({ dir: path }) => contents[path]);
  await store.refreshExpanded();
  expect(snapshots.at(-1)).toEqual({ loading: false, error: null });
});
it("renders hidden compact-parent progress and errors through the real virtual list", async () => {
  mocks.settings.settings.compactFileTree = true;
  contents = { "": [dir("src")], src: [dir("src/one")], "src/one": [] };
  const store = await opened();
  store.filter = "src/one";
  store.select("src/one");
  const rows = store.rows;
  const selection = store.selectedPaths;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(
          VirtualList<FileTreeRow>,
          {
            items: store.rows,
            itemHeight: 24,
            getKey: (row) => row.key,
          },
          {
            default: ({ item }: { item: (typeof store.rows)[number] }) =>
              h(
                "div",
                {
                  "data-path": item.path,
                  "aria-busy": item.loading,
                  title: item.error ?? "",
                },
                item.name,
              ),
          },
        ),
    }),
  );
  const child = deferred();
  mocks.fsReadDir.mockImplementation(({ dir: path }) =>
    path === "" ? Promise.resolve(contents[""]) : child.promise,
  );
  const refreshing = store.refreshExpanded();
  try {
    await flushPromises();
    const row = wrapper.get('[data-path="src/one"]');
    expect(row.attributes("aria-busy")).toBe("true");
    child.reject(new Error("parent denied"));
    await refreshing;
    await flushPromises();
    expect(row.attributes("aria-busy")).toBe("false");
    expect(row.attributes("title")).toBe("parent denied");
    expect(store.rows).toBe(rows);
    expect(store.selectedPaths).toBe(selection);
    mocks.fsReadDir.mockImplementation(async ({ dir: path }) =>
      contents[path]!.map((entry) => ({ ...entry })),
    );
    await store.refreshExpanded();
    await flushPromises();
    expect(row.attributes("title")).toBe("");
    expect(store.rows).toBe(rows);
    expect(store.selectedPaths).toBe(selection);
  } finally {
    child.resolve([]);
    await refreshing;
    wrapper.unmount();
    vi.unstubAllGlobals();
  }
});
it.each(["name", "order", "kind"] as const)(
  "publishes a real %s change even with the same entry count",
  async (field) => {
    const store = await opened();
    const before = store.rows;
    if (field === "name") contents.src = [{ ...file("src/a"), name: "A" }, file("src/b")];
    if (field === "order") contents.src = [file("src/b"), file("src/a")];
    if (field === "kind") contents.src = [dir("src/a"), file("src/b")];
    await store.refreshExpanded();
    expect(store.rows).not.toBe(before);
    expect(
      store.rows
        .filter((row) => row.depth === 1)
        .map(({ path, name, kind }) => ({ path, name, kind })),
    ).toEqual(contents.src);
  },
);
it.each(["same", "replaced", "navigation"] as const)(
  "retries a compact parent safely when its result is %s",
  async (outcome) => {
    mocks.settings.settings.compactFileTree = true;
    contents = { "": [dir("src")], src: [dir("src/one")], "src/one": [file("src/one/a")] };
    const store = await opened();
    mocks.fsReadDir.mockImplementation(({ dir: path }) =>
      path === "src" ? Promise.reject(new Error("parent denied")) : Promise.resolve(contents[path]),
    );
    await store.refreshExpanded();
    expect(store.rows[0]?.error).toBe("parent denied");
    const retry = deferred();
    mocks.fsReadDir.mockClear();
    mocks.fsReadDir.mockImplementation(({ dir: path }) =>
      path === "src" ? retry.promise : Promise.resolve(contents[path]),
    );
    const expanding = store.expand("src/one");
    expect(mocks.fsReadDir.mock.calls.map(([req]) => req.dir)).toEqual(["src"]);
    if (outcome === "navigation") mocks.workspace.token++;
    retry.resolve(outcome === "replaced" ? [dir("src/two")] : contents.src!);
    await expanding;
    if (outcome === "same") {
      expect(store.rows.map((row) => row.path)).toEqual(["src/one", "src/one/a"]);
      expect(store.rows[0]?.error).toBeNull();
    } else {
      expect(mocks.fsReadDir.mock.calls.map(([req]) => req.dir)).toEqual(["src"]);
      expect(store.rows.map((row) => row.path)).toEqual(outcome === "replaced" ? ["src/two"] : []);
    }
  },
);
it("removes vanished compact targets and rebuilds only the currently loaded chain", async () => {
  mocks.settings.settings.compactFileTree = true;
  contents = { "": [dir("src")], src: [dir("src/one")], "src/one": [file("src/one/a")] };
  const store = await opened();
  await store.expand("src/one");
  store.select("src/one");
  store.select("src/one/a", { toggle: true });
  contents.src = [dir("src/two")];
  await store.refreshExpanded();
  expect(store.rows.map((row) => row.path)).toEqual(["src/two"]);
  expect(store.selectedPaths).toEqual([]);
  expect(store.selectedPath).toBeNull();
  expect(mocks.fsReadDir.mock.lastCall![0].dir).toBe("src");
});
it.runIf(process.env.GITX_QA_FILE_TREE_COST === "1")(
  "measures unchanged refreshes of 20,020 rows and 20 expanded directories",
  async () => {
    contents = { "": Array.from({ length: 20 }, (_, i) => dir(`dir-${i}`)) };
    for (const entry of contents[""]!)
      contents[entry.path] = Array.from({ length: 1000 }, (_, i) =>
        file(`${entry.path}/file-${i}.txt`),
      );
    const store = useFileTreeStore();
    await store.loadRoot();
    for (const entry of contents[""]!) await store.expand(entry.path);
    store.select("dir-0/file-0.txt");
    let rowPublications = 0;
    let selectionPublications = 0;
    stops.push(
      watch(
        () => store.rows,
        () => rowPublications++,
        { flush: "sync" },
      ),
    );
    stops.push(
      watch(
        () => store.selectedPaths,
        () => selectionPublications++,
        { flush: "sync" },
      ),
    );
    const samples = [];
    for (let round = 0; round < 5; round++) {
      rowPublications = 0;
      selectionPublications = 0;
      const start = performance.now();
      await store.refreshExpanded();
      samples.push({
        ms: performance.now() - start,
        rowPublications,
        selectionPublications,
        rows: store.rows.length,
      });
      expect(store.rows).toHaveLength(20020);
      expect(store.selectedPaths).toEqual(["dir-0/file-0.txt"]);
    }
    console.log("QA104_FILE_TREE_COST", JSON.stringify(samples));
  },
  120000,
);
