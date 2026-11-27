import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useFileTreeStore } from "./fileTreeStore";

const mocks = vi.hoisted(() => ({ fsReadDir: vi.fn(), workspace: {} as any, settings: {} as any }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
const file = (path: string) => ({ path, name: path.split("/").pop()!, kind: "file" });
const dir = (path: string) => ({ ...file(path), kind: "directory" });
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
it("selects ranges and toggles items, then removes hidden and collapsed batch targets", async () => {
  mocks.fsReadDir.mockResolvedValueOnce([dir("src"), file("a"), file("b"), file("c")]);
  const store = useFileTreeStore();
  await store.loadRoot();
  store.select("a");
  store.select("c", { range: true });
  expect(store.selectedPaths).toEqual(["a", "b", "c"]);
  store.select("b", { toggle: true });
  expect(store.selectedPaths).toEqual(["a", "c"]);
  store.filter = "c";
  expect(store.selectedPaths).toEqual(["c"]);
  store.filter = "";
  mocks.fsReadDir.mockResolvedValueOnce([file("src/child")]);
  await store.expand("src");
  store.selectAll();
  store.collapse("src");
  expect(store.selectedPaths).not.toContain("src/child");
  mocks.workspace.token++;
  expect(store.selectedPaths).toEqual([]);
});
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.workspace = reactive({
    folderPath: "C:/project",
    token: 1,
    appliedOpenToken() {
      return this.token;
    },
  });
  mocks.settings = reactive({
    settings: { showIgnoredInFileTree: false, showHiddenInFileTree: false },
  });
  mocks.fsReadDir.mockResolvedValue([]);
});

it("does not list unopened folders; opens one directory and reuses its cache", async () => {
  const store = useFileTreeStore();
  await store.refreshExpanded();
  expect(mocks.fsReadDir).not.toHaveBeenCalled();
  mocks.fsReadDir.mockResolvedValueOnce([dir("src"), file("readme.md")]);
  await store.loadRoot();
  expect(store.rows.map((r) => r.path)).toEqual(["src", "readme.md"]);
  mocks.fsReadDir.mockResolvedValueOnce([file("src/app.ts")]);
  await store.expand("src");
  expect(store.rows.map((r) => r.path)).toEqual(["src", "src/app.ts", "readme.md"]);
  store.collapse("src");
  expect(store.rows).toHaveLength(2);
  await store.expand("src");
  expect(mocks.fsReadDir).toHaveBeenCalledTimes(2);
  expect(store.rows[1]).toMatchObject({ key: "file:src/app.ts", depth: 1 });
});
it("compacts only loaded single-directory chains and refreshes their hidden parents", async () => {
  mocks.settings.settings.compactFileTree = true;
  mocks.fsReadDir.mockImplementation(
    async ({ dir: path }) =>
      ({ "": [dir("src")], src: [dir("src/one")], "src/one": [file("src/one/a")] })[
        path as string
      ] ?? [],
  );
  const store = useFileTreeStore();
  await store.loadRoot();
  expect(mocks.fsReadDir).toHaveBeenCalledTimes(1);
  await store.expand("src");
  expect(store.rows[0]).toMatchObject({ name: "src/one", path: "src/one", compactRoot: "src" });
  await store.expand("src/one");
  expect(store.rows[1]?.path).toBe("src/one/a");
  mocks.fsReadDir.mockClear();
  await store.refreshExpanded();
  expect(mocks.fsReadDir.mock.calls.map(([req]) => req.dir)).toEqual(["", "src", "src/one"]);
  mocks.settings.settings.compactFileTree = false;
  expect(store.rows.map((row) => row.name)).toEqual(["src", "one", "a"]);
});

it("coalesces directory requests and ignores an old workspace completion", async () => {
  const old = deferred();
  mocks.fsReadDir.mockReturnValueOnce(old.promise);
  const store = useFileTreeStore();
  const first = store.loadRoot();
  const duplicate = store.loadRoot();
  expect(mocks.fsReadDir).toHaveBeenCalledTimes(1);
  mocks.workspace.folderPath = "C:/next";
  mocks.fsReadDir.mockResolvedValueOnce([file("new.txt")]);
  await store.loadRoot();
  old.resolve([file("old.txt")]);
  await Promise.all([first, duplicate]);
  expect(store.rows.map((r) => r.path)).toEqual(["new.txt"]);
  expect(store.loading).toBe(false);
});

it("retries errors and refreshes an invalidation received during a read", async () => {
  const store = useFileTreeStore();
  mocks.fsReadDir.mockRejectedValueOnce(new Error("denied"));
  await store.loadRoot();
  expect(store.error).toContain("denied");
  const old = deferred();
  mocks.fsReadDir.mockReturnValueOnce(old.promise).mockResolvedValueOnce([file("fresh.txt")]);
  const retry = store.loadRoot();
  const refresh = store.refreshExpanded();
  old.resolve([file("obsolete.txt")]);
  await Promise.all([retry, refresh]);
  expect(store.error).toBeNull();
  expect(store.rows.map((r) => r.path)).toEqual(["fresh.txt"]);
});

it("reloads only expanded directories, invalidates collapsed caches and retains selection", async () => {
  const entries: Record<string, any[]> = {
    "": [dir("src"), dir("test")],
    src: [file("src/keep.ts")],
    test: [file("test/old.ts")],
  };
  mocks.fsReadDir.mockImplementation(({ dir: path }) => Promise.resolve(entries[path]));
  const store = useFileTreeStore();
  await store.loadRoot();
  await store.expand("src");
  await store.expand("test");
  store.selectedPath = "src/keep.ts";
  store.collapse("test");
  mocks.fsReadDir.mockClear();
  entries.test = [file("test/new.ts")];
  await store.refreshExpanded();
  expect(mocks.fsReadDir.mock.calls.map(([req]) => req.dir)).toEqual(["", "src"]);
  expect(store.selectedPath).toBe("src/keep.ts");
  await store.expand("test");
  expect(store.rows.some((r) => r.path === "test/new.ts")).toBe(true);
});

it("removes stale expansion and selection when a directory becomes a file", async () => {
  mocks.fsReadDir.mockResolvedValueOnce([dir("src")]).mockResolvedValueOnce([file("src/a")]);
  const store = useFileTreeStore();
  await store.loadRoot();
  await store.expand("src");
  store.selectedPath = "src/a";
  mocks.fsReadDir.mockResolvedValueOnce([file("src")]);
  await store.refreshExpanded();
  expect(store.rows.map((r) => r.key)).toEqual(["file:src"]);
  expect(store.selectedPath).toBeNull();
});

it("filters loaded visible names with ancestors, preserving expansion when cleared", async () => {
  mocks.fsReadDir
    .mockResolvedValueOnce([dir("src"), file("readme")])
    .mockResolvedValueOnce([file("src/target.ts"), file("src/other")]);
  const store = useFileTreeStore();
  await store.loadRoot();
  await store.expand("src");
  store.filter = "TARGET";
  expect(store.rows.map((r) => r.path)).toEqual(["src", "src/target.ts"]);
  store.filter = "";
  expect(store.rows).toHaveLength(4);
  store.collapse("src");
  store.filter = "target";
  expect(store.rows).toHaveLength(0);
  expect(mocks.fsReadDir).toHaveBeenCalledTimes(2);
});

it("uses independent visibility flags and resets on a same-path published reopen", async () => {
  const store = useFileTreeStore();
  await store.loadRoot();
  mocks.settings.settings.showIgnoredInFileTree = true;
  await vi.waitFor(() => expect(mocks.fsReadDir).toHaveBeenCalledTimes(2));
  expect(mocks.fsReadDir.mock.lastCall![0]).toMatchObject({ showIgnored: true, showHidden: false });
  mocks.workspace.token++;
  expect(store.initialized).toBe(false);
  expect(store.rows).toHaveLength(0);
});

it("flattens thousands of root entries without requesting collapsed descendants", async () => {
  mocks.fsReadDir.mockResolvedValueOnce(Array.from({ length: 4000 }, (_, i) => dir(`dir-${i}`)));
  const store = useFileTreeStore();
  await store.loadRoot();
  expect(store.rows).toHaveLength(4000);
  expect(mocks.fsReadDir).toHaveBeenCalledTimes(1);
});

it("repeats root invalidation arriving while expanded children are refreshing", async () => {
  const store = useFileTreeStore();
  mocks.fsReadDir.mockResolvedValueOnce([dir("src")]).mockResolvedValueOnce([file("src/old")]);
  await store.loadRoot();
  await store.expand("src");
  const child = deferred();
  mocks.fsReadDir
    .mockResolvedValueOnce([dir("src")])
    .mockReturnValueOnce(child.promise)
    .mockResolvedValueOnce([file("src/new")])
    .mockResolvedValueOnce([dir("src"), file("new-root.txt")]);
  const first = store.refreshExpanded();
  await vi.waitFor(() => expect(mocks.fsReadDir).toHaveBeenCalledTimes(4));
  const second = store.refreshExpanded();
  child.resolve([file("src/stale")]);
  await Promise.all([first, second]);
  expect(store.rows.map((row) => row.path)).toEqual(["src", "src/new", "new-root.txt"]);
});

it("reveals a nested file by expanding parents, clearing a blocking filter, and selecting it", async () => {
  mocks.fsReadDir.mockImplementation(
    async ({ dir: path }) =>
      ({ "": [dir("src")], src: [dir("src/nested")], "src/nested": [file("src/nested/a.ts")] })[
        path as string
      ] ?? [],
  );
  const store = useFileTreeStore();
  await store.loadRoot();
  store.filter = "zzz";
  expect(await store.revealPath("src/nested/a.ts")).toBe(true);
  expect(store.filter).toBe("");
  expect(store.selectedPath).toBe("src/nested/a.ts");
  expect(store.rows.some((row) => row.path === "src/nested/a.ts")).toBe(true);
  expect(await store.revealPath("missing/file.ts")).toBe(false);
  expect(await store.revealPath("../escape")).toBe(false);
});
