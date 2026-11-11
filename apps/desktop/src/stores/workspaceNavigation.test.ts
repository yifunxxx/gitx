import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { watch } from "vue";
import { useWorkspaceStore } from "./workspaceStore";

const backend = vi.hoisted(() => ({
  workspaceOpen: vi.fn(), workspaceRecent: vi.fn(), repoDiscover: vi.fn(),
  initRun: vi.fn(), vcsEnable: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => backend }));

const root = (path: string) => ({
  id: path, worktreeRoot: path, gitDir: `${path}/.git`, commonDir: `${path}/.git`,
  isWorktree: false, displayName: path, color: "#fff", isSubmodule: false,
});
const opened = (path: string) => ({
  path, isRepo: true, gitDir: `${path}/.git`, toplevel: path, roots: [root(path)],
});
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  backend.workspaceOpen.mockImplementation(({ path }) => Promise.resolve(opened(path)));
  backend.workspaceRecent.mockResolvedValue({ paths: [] });
});

it("notifies menu guards as soon as navigation starts, even when reopening the same path", async () => {
  const store = useWorkspaceStore();
  await store.openFolder("A");
  const pending = deferred();
  backend.workspaceOpen.mockReturnValueOnce(pending.promise);
  const invalidated = vi.fn();
  const stop = watch(() => store.navigationToken(), invalidated, { flush: "sync" });
  const reopen = store.openFolder("A");
  expect(invalidated).toHaveBeenCalledOnce();
  expect(store.repoPath).toBe("A");
  pending.resolve(opened("A"));
  await reopen;
  stop();
});

it("keeps the latest folder when an earlier open finishes later", async () => {
  const first = deferred();
  backend.workspaceOpen.mockReturnValueOnce(first.promise);
  const store = useWorkspaceStore();
  const pending = store.openFolder("A");
  await store.openFolder("B");
  first.resolve(opened("A"));
  await pending;
  expect(store.repoPath).toBe("B");
  expect(store.gitDir).toBe("B/.git");
  expect(backend.workspaceRecent).toHaveBeenCalledOnce();
});

it("invalidates prior navigation even after switching A to B to A", async () => {
  const store = useWorkspaceStore();
  await store.openFolder("A");
  const old = store.navigationToken();
  await store.openFolder("B");
  await store.openFolder("A");
  expect(store.repoPath).toBe("A");
  expect(store.navigationToken()).not.toBe(old);
});

it.each(["initRepo", "enableVcs"] as const)("does not let a late %s reopen the old folder", async (method) => {
  const store = useWorkspaceStore();
  await store.openFolder("A");
  const pending = deferred();
  (method === "initRepo" ? backend.initRun : backend.vcsEnable).mockReturnValue(pending.promise);
  const operation = method === "initRepo" ? store.initRepo("A") : store.enableVcs();
  await store.openFolder("B");
  pending.resolve(opened("A"));
  await operation;
  expect(store.repoPath).toBe("B");
  expect(store.folderPath).toBe("B");
  expect(store.gitDir).toBe("B/.git");
});

it("discards discovered roots from an earlier folder visit", async () => {
  const store = useWorkspaceStore();
  await store.openFolder("A");
  const old = deferred();
  backend.repoDiscover.mockReturnValue(old.promise);
  const refresh = store.refreshRoots();
  await store.openFolder("B");
  await store.openFolder("A");
  old.resolve([root("stale-submodule")]);
  await refresh;
  expect(store.roots.map((entry) => entry.id)).toEqual(["A"]);
});

it("keeps the most recent discovery result when refreshes overlap", async () => {
  const store = useWorkspaceStore();
  await store.openFolder("A");
  const old = deferred();
  backend.repoDiscover.mockReturnValueOnce(old.promise).mockResolvedValueOnce([root("A"), root("new")]);
  const refresh = store.refreshRoots();
  await store.refreshRoots();
  old.resolve([root("A"), root("old")]);
  await refresh;
  expect(store.roots.map((entry) => entry.id)).toEqual(["A", "new"]);
});

it("keeps the most recent recent-folder response", async () => {
  const store = useWorkspaceStore();
  const old = deferred();
  backend.workspaceRecent.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ paths: ["B", "A"] });
  const refresh = store.loadRecent();
  await store.loadRecent();
  old.resolve({ paths: ["A"] });
  await refresh;
  expect(store.recent).toEqual(["B", "A"]);
});

it("clears stale branch info and advances navigation only for a real active-root change", async () => {
  const store = useWorkspaceStore();
  backend.workspaceOpen.mockResolvedValueOnce({ ...opened("A"), roots: [root("A"), root("B")] });
  await store.openFolder("A");
  store.setBranch({ name: "old" } as any);
  const old = store.navigationToken();
  store.setActiveRepo("unknown");
  store.setActiveRepo("A");
  expect(store.navigationToken()).toBe(old);
  store.setActiveRepo("B");
  expect(store.navigationToken()).not.toBe(old);
  expect(store.branch).toBeNull();
  expect(store.repoPath).toBe("B");
  expect(store.gitDir).toBe("B/.git");
  store.setBranch({ name: "another" } as any);
  await store.openFolder("C");
  expect(store.branch).toBeNull();
});
