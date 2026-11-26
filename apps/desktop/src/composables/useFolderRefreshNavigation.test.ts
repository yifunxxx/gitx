import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import { useRepositoryRefresh } from "./useRepositoryRefresh";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useFileTreeStore } from "@/stores/fileTreeStore";
import type { FsEntry } from "@/lib/backend";

const m = vi.hoisted(() => ({
  backend: {
    workspaceOpen: vi.fn(),
    workspaceRecent: vi.fn(),
    workspaceWatch: vi.fn(),
    workspaceUnwatch: vi.fn(),
    fsReadDir: vi.fn(),
  },
  refresh: vi.fn(),
  append: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m.backend }));
vi.mock("@/lib/utils", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: m.listen }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: m.refresh }) }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({ refresh: m.refresh }) }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => ({ load: m.refresh }) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({ refreshLiveTabs: m.refresh }) }));
vi.mock("@/stores/rewriteStore", () => ({
  useRewriteStore: () => ({ busy: false, refreshOpState: m.refresh }),
}));
vi.mock("@/stores/conflictsStore", () => ({ useConflictsStore: () => ({ refresh: m.refresh }) }));
vi.mock("@/stores/worktreesStore", () => ({ useWorktreesStore: () => ({ refresh: m.refresh }) }));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => ({ refresh: m.refresh }) }));
vi.mock("@/stores/jobsStore", () => ({ useJobsStore: () => ({ count: 0 }) }));
vi.mock("@/stores/syncStore", () => ({ useSyncStore: () => ({}) }));
vi.mock("@/stores/consoleStore", () => ({ useConsoleStore: () => ({ append: m.append }) }));

let pinia: ReturnType<typeof createPinia>;
let host: ReturnType<typeof mount> | undefined;
const releases: Array<() => void> = [];
const file = (path: string): FsEntry => ({ path, name: path, kind: "file" });
function delayed<T>(fallback: T) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  releases.push(() => resolve(fallback));
  return { promise, resolve };
}
async function open(path: string) {
  await useWorkspaceStore().openFolder(path);
  await useFileTreeStore().loadRoot();
}
async function setup(refresh?: () => Promise<void>) {
  await open("A");
  const tree = useFileTreeStore();
  const refreshSpy = vi.spyOn(tree, "refreshExpanded");
  host = mount(
    defineComponent({
      setup() {
        useRepositoryRefresh(refresh ?? (() => tree.refreshExpanded()));
        return () => null;
      },
    }),
    { global: { plugins: [pinia] } },
  );
  await flushPromises();
  return { tree, refreshSpy };
}
async function focus() {
  window.dispatchEvent(new Event("focus"));
  await flushPromises();
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  pinia = createPinia();
  setActivePinia(pinia);
  m.backend.workspaceOpen.mockImplementation(async ({ path }) => ({
    path,
    isRepo: false,
    gitDir: null,
    toplevel: null,
  }));
  m.backend.workspaceRecent.mockResolvedValue({ paths: [] });
  m.backend.workspaceWatch.mockResolvedValue(null);
  m.backend.workspaceUnwatch.mockResolvedValue(null);
  m.backend.fsReadDir.mockImplementation(async ({ folderPath }) => [file(`${folderPath}-initial`)]);
  m.listen.mockResolvedValue(m.unlisten);
});
afterEach(async () => {
  host?.unmount();
  host = undefined;
  releases.splice(0).forEach((release) => release());
  await flushPromises();
  disposePinia(pinia);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(["A", "B"])(
  "refreshes %s after opening while the previous folder read is pending",
  async (path) => {
    const { tree } = await setup();
    const old = delayed([file("A-old")]);
    m.backend.fsReadDir.mockReturnValueOnce(old.promise);
    await focus();
    expect(tree.loading).toBe(true);
    await open(path);
    expect(tree.rows.map((row) => row.path)).toEqual([`${path}-initial`]);
    m.backend.fsReadDir.mockResolvedValue([file(`${path}-updated`)]);
    // The five-second fallback must work without a new focus event as well.
    await vi.advanceTimersByTimeAsync(5000);
    expect(tree.rows.map((row) => row.path)).toEqual([`${path}-updated`]);
    old.resolve([file("A-obsolete")]);
    await flushPromises();
    expect(tree.rows.map((row) => row.path)).toEqual([`${path}-updated`]);
    expect(tree.loading).toBe(false);
    expect(m.refresh).not.toHaveBeenCalled();
  },
);

it("does not let an old completion release the current folder's in-flight refresh", async () => {
  const { tree, refreshSpy } = await setup();
  const old = delayed([file("A-old")]);
  m.backend.fsReadDir.mockReturnValueOnce(old.promise);
  await focus();
  await open("B");
  const current = delayed([file("B-updated")]);
  m.backend.fsReadDir.mockReturnValueOnce(current.promise);
  await focus();
  expect(refreshSpy).toHaveBeenCalledTimes(2);
  old.resolve([file("A-obsolete")]);
  await flushPromises();
  await focus();
  await vi.advanceTimersByTimeAsync(5000);
  expect(refreshSpy).toHaveBeenCalledTimes(2);
  current.resolve([file("B-updated")]);
  await flushPromises();
  expect(tree.rows.map((row) => row.path)).toEqual(["B-updated"]);
  await focus();
  expect(refreshSpy).toHaveBeenCalledTimes(3);
});

it("retires a read started during a same-path open when the new folder is published", async () => {
  const { tree } = await setup();
  const openingResult = { path: "A", isRepo: false, gitDir: null, toplevel: null };
  const opening = delayed(openingResult);
  m.backend.workspaceOpen.mockReturnValueOnce(opening.promise);
  const reopened = useWorkspaceStore().openFolder("A");
  const old = delayed([file("A-obsolete")]);
  m.backend.fsReadDir.mockReturnValueOnce(old.promise);
  await focus();
  const navigation = useWorkspaceStore().navigationToken();
  opening.resolve(openingResult);
  await reopened;
  expect(useWorkspaceStore().navigationToken()).toBe(navigation);
  await tree.loadRoot();
  m.backend.fsReadDir.mockResolvedValue([file("A-updated")]);
  await focus();
  expect(tree.rows.map((row) => row.path)).toEqual(["A-updated"]);
  old.resolve([file("A-obsolete")]);
  await flushPromises();
  expect(tree.rows.map((row) => row.path)).toEqual(["A-updated"]);
});

it("does not hold Git refreshes behind a previous non-Git folder read", async () => {
  const { tree } = await setup();
  const old = delayed([file("A-obsolete")]);
  m.backend.fsReadDir.mockReturnValueOnce(old.promise);
  await focus();
  m.backend.workspaceOpen.mockResolvedValueOnce({
    path: "B",
    isRepo: true,
    gitDir: "B/.git",
    toplevel: "B",
  });
  await open("B");
  m.backend.fsReadDir.mockResolvedValue([file("B-updated")]);
  await focus();
  await vi.advanceTimersByTimeAsync(200);
  expect(tree.rows.map((row) => row.path)).toEqual(["B-updated"]);
  expect(m.refresh).toHaveBeenCalled();
  old.resolve([file("A-obsolete")]);
  await flushPromises();
  expect(tree.rows.map((row) => row.path)).toEqual(["B-updated"]);
});

it("skips a queued callback after navigation but accepts a new focus request", async () => {
  const { refreshSpy } = await setup();
  window.dispatchEvent(new Event("focus"));
  const opening = useWorkspaceStore().openFolder("B");
  await opening;
  await useFileTreeStore().loadRoot();
  await flushPromises();
  expect(refreshSpy).not.toHaveBeenCalled();
  await focus();
  expect(refreshSpy).toHaveBeenCalledOnce();
});

it("retires queued work when its owner unmounts before the microtask starts", async () => {
  const { refreshSpy } = await setup();
  window.dispatchEvent(new Event("focus"));
  host!.unmount();
  host = undefined;
  await flushPromises();
  expect(refreshSpy).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("isolates an old callback error but reports current errors and retries on focus", async () => {
  const gate = delayed(undefined);
  const callback = vi
    .fn()
    .mockImplementationOnce(async () => {
      await gate.promise;
      throw new Error("A obsolete");
    })
    .mockRejectedValueOnce(new Error("B current"))
    .mockResolvedValue(undefined);
  await setup(callback);
  await focus();
  await open("B");
  gate.resolve(undefined);
  await flushPromises();
  expect(m.append).not.toHaveBeenCalled();
  await focus();
  expect(m.append).toHaveBeenCalledExactlyOnceWith("stderr", "B current");
  await focus();
  expect(callback).toHaveBeenCalledTimes(3);
});

it("keeps one pending read within the current folder and resumes after visibility returns", async () => {
  const { tree, refreshSpy } = await setup();
  const current = delayed([file("A-updated")]);
  m.backend.fsReadDir.mockReturnValueOnce(current.promise);
  await focus();
  await focus();
  await vi.advanceTimersByTimeAsync(10000);
  expect(refreshSpy).toHaveBeenCalledOnce();
  current.resolve([file("A-updated")]);
  await flushPromises();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await focus();
  await vi.advanceTimersByTimeAsync(5000);
  expect(refreshSpy).toHaveBeenCalledOnce();
  visibility.mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  await flushPromises();
  expect(refreshSpy).toHaveBeenCalledTimes(2);
  expect(tree.error).toBeNull();
});
