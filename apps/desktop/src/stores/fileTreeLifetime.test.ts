import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { flushPromises } from "@vue/test-utils";
import type { FsEntry } from "@/lib/backend";
import { useFileTreeStore } from "./fileTreeStore";

const mocks = vi.hoisted(() => ({ fsReadDir: vi.fn(), workspace: {} as any, settings: {} as any }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
const file = (path: string): FsEntry => ({ path, name: path.split("/").at(-1)!, kind: "file" });
const dir = (path: string): FsEntry => ({ ...file(path), kind: "directory" });
function deferred() {
  let resolve!: (value: FsEntry[]) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<FsEntry[]>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let pinia: ReturnType<typeof createPinia>;
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
  mocks.settings = reactive({
    settings: { showIgnoredInFileTree: false, showHiddenInFileTree: false },
  });
});
afterEach(() => disposePinia(pinia));

it.each(["removed", "file"] as const)(
  "starts a fresh read after a directory is %s and recreated, without waiting for its old read",
  async (replacement) => {
    const old = deferred();
    const fresh = deferred();
    let roots: FsEntry[] = [dir("src")];
    let childCalls = 0;
    mocks.fsReadDir.mockImplementation(({ dir: path }) =>
      path === "" ? Promise.resolve(roots) : ++childCalls === 1 ? old.promise : fresh.promise,
    );
    const store = useFileTreeStore();
    await store.loadRoot();
    const expanding = store.expand("src");
    roots = replacement === "removed" ? [] : [{ ...file("src"), kind: replacement }];
    await store.refreshExpanded();
    roots = [dir("src")];
    await store.refreshExpanded();
    const recreated = store.expand("src");
    await flushPromises();
    try {
      expect(childCalls).toBe(2);
      fresh.resolve([file("src/new.txt")]);
      await recreated;
      expect(store.rows.map((row) => row.path)).toEqual(["src", "src/new.txt"]);
      old.resolve([file("src/obsolete.txt")]);
      await expanding;
      expect(store.rows.map((row) => row.path)).toEqual(["src", "src/new.txt"]);
      expect(store.rows[0]).toMatchObject({ loading: false, error: null });
    } finally {
      old.resolve([]);
      fresh.resolve([]);
      await Promise.all([expanding, recreated]);
    }
  },
);

it("retires descendant reads when an ancestor disappears, without retiring a prefix sibling", async () => {
  const old = deferred();
  const fresh = deferred();
  let roots = [dir("src"), dir("src2")];
  let leafCalls = 0;
  mocks.fsReadDir.mockImplementation(({ dir: path }) => {
    if (path === "") return Promise.resolve(roots);
    if (path === "src") return Promise.resolve([dir("src/nested")]);
    if (path === "src2") return Promise.resolve([file("src2/keep.txt")]);
    return ++leafCalls === 1 ? old.promise : fresh.promise;
  });
  const store = useFileTreeStore();
  await store.loadRoot();
  await store.expand("src");
  await store.expand("src2");
  store.select("src2/keep.txt");
  const expanding = store.expand("src/nested");
  roots = [dir("src2")];
  await store.refreshExpanded();
  expect(store.selectedPaths).toEqual(["src2/keep.txt"]);
  roots = [dir("src"), dir("src2")];
  await store.refreshExpanded();
  await store.expand("src");
  const recreated = store.expand("src/nested");
  await flushPromises();
  try {
    expect(leafCalls).toBe(2);
    fresh.resolve([file("src/nested/new.txt")]);
    await recreated;
    old.reject(new Error("old directory no longer exists"));
    await expanding;
    expect(store.rows.map((row) => row.path)).toEqual([
      "src",
      "src/nested",
      "src/nested/new.txt",
      "src2",
      "src2/keep.txt",
    ]);
    expect(store.rows[1]).toMatchObject({ loading: false, error: null });
  } finally {
    old.resolve([]);
    fresh.resolve([]);
    await Promise.all([expanding, recreated]);
  }
});

it("does not let an obsolete completion clear the new pending read", async () => {
  const old = deferred();
  const fresh = deferred();
  let roots = [dir("src")];
  let childCalls = 0;
  mocks.fsReadDir.mockImplementation(({ dir: path }) =>
    path === "" ? Promise.resolve(roots) : ++childCalls === 1 ? old.promise : fresh.promise,
  );
  const store = useFileTreeStore();
  await store.loadRoot();
  const first = store.expand("src");
  roots = [];
  await store.refreshExpanded();
  roots = [dir("src")];
  await store.refreshExpanded();
  const second = store.expand("src");
  await flushPromises();
  try {
    expect(childCalls).toBe(2);
    old.resolve([file("src/stale")]);
    await first;
    expect(store.rows[0]?.loading).toBe(true);
    const duplicate = store.expand("src");
    await flushPromises();
    expect(childCalls).toBe(2);
    fresh.resolve([file("src/current")]);
    await Promise.all([second, duplicate]);
    expect(store.rows.map((row) => row.path)).toEqual(["src", "src/current"]);
  } finally {
    old.resolve([]);
    fresh.resolve([]);
    await Promise.all([first, second]);
  }
});

it("keeps a collapsed directory's pending read reusable while its parent still lists it", async () => {
  const pending = deferred();
  mocks.fsReadDir.mockImplementation(({ dir: path }) =>
    path === "" ? Promise.resolve([dir("src")]) : pending.promise,
  );
  const store = useFileTreeStore();
  await store.loadRoot();
  const first = store.expand("src");
  store.collapse("src");
  const second = store.expand("src");
  expect(mocks.fsReadDir).toHaveBeenCalledTimes(2);
  pending.resolve([file("src/current")]);
  await Promise.all([first, second]);
  expect(store.rows.map((row) => row.path)).toEqual(["src", "src/current"]);
});
