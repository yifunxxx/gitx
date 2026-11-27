import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { useFileViewerStore } from "./fileViewerStore";

const mocks = vi.hoisted(() => ({
  fsReadFile: vi.fn(),
  fileWriteWorktree: vi.fn(),
  diffFile: vi.fn(),
  workspace: {} as any,
  refresh: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => ({ activeEditorKind: "file" }) }));
vi.mock("./changesStore", () => ({ useChangesStore: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));

function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const initialHunks = [{ index: 0 }];
const savedHunks = [{ index: 1 }];
const diff = (text: string | null, hunks = savedHunks) => ({ rightText: text, hunks });
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  mocks.workspace = reactive({
    repoPath: "C:/repo",
    folderPath: "C:/repo",
    repoId: "repo",
    isRepo: true,
    token: 1,
    navigationToken() {
      return this.token;
    },
    appliedOpenToken() {
      return this.token;
    },
  });
  mocks.fsReadFile.mockResolvedValue("initial\n");
  mocks.fileWriteWorktree.mockResolvedValue(null);
  mocks.diffFile.mockResolvedValue(diff("initial\n", initialHunks));
});
afterEach(() => disposePinia(pinia));

async function setup() {
  const store = useFileViewerStore();
  await store.open("note.txt");
  const tab = store.tabs[0]!;
  mocks.diffFile.mockClear();
  store.setDocument(tab.id, "saved\n");
  return { store, tab };
}

it.each([false, true])(
  "completes saves and coalesces slow gutters (first read fails: %s)",
  async (fails) => {
    const { store, tab } = await setup();
    const read = deferred();
    mocks.diffFile.mockReturnValueOnce(read.promise).mockResolvedValue(diff("third\n"));
    let finished = false;
    const first = store.save(tab.id).then((ok) => {
      finished = ok;
      return ok;
    });
    await flushPromises();
    const feedback = { finished, saving: tab.saving, refreshes: mocks.refresh.mock.calls.length };
    store.setDocument(tab.id, "second\n");
    const second = store.save(tab.id);
    await flushPromises();
    store.setDocument(tab.id, "third\n");
    const third = store.save(tab.id);
    await flushPromises();
    const beforeRead = {
      writes: mocks.fileWriteWorktree.mock.calls.length,
      reads: mocks.diffFile.mock.calls.length,
    };
    if (fails) read.reject(new Error("old HEAD unavailable"));
    else read.resolve(diff("saved\n", initialHunks));
    const results = await Promise.all([first, second, third]);
    await flushPromises();
    expect(feedback).toEqual({ finished: true, saving: false, refreshes: 1 });
    expect(beforeRead).toEqual({ writes: 3, reads: 1 });
    expect(results).toEqual([true, true, true]);
    expect(mocks.diffFile).toHaveBeenCalledTimes(2);
    expect(mocks.fileWriteWorktree.mock.calls.map(([args]) => args.content)).toEqual([
      "saved\n",
      "second\n",
      "third\n",
    ]);
    expect(tab).toMatchObject({
      text: "third\n",
      baseline: "third\n",
      dirty: false,
      saving: false,
      hunks: savedHunks,
    });
  },
);

it.each(["different\n", null])("discards gutters whose disk snapshot is %s", async (snapshot) => {
  const { store, tab } = await setup();
  mocks.diffFile.mockResolvedValue(diff(snapshot));
  expect(await store.save(tab.id)).toBe(true);
  await flushPromises();
  expect(tab).toMatchObject({ text: "saved\n", baseline: "saved\n", dirty: false, hunks: [] });
});

it("clears obsolete marks after an auxiliary failure without reporting a failed save", async () => {
  const { store, tab } = await setup();
  mocks.diffFile.mockRejectedValue(new Error("HEAD unavailable"));
  expect(await store.save(tab.id)).toBe(true);
  await flushPromises();
  expect(tab).toMatchObject({ baseline: "saved\n", dirty: false, saving: false, hunks: [] });
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("accepts matching gutters without changing the document or load generation", async () => {
  const { store, tab } = await setup();
  const generation = tab.loadGeneration;
  mocks.diffFile.mockResolvedValue(diff("saved\n"));
  expect(await store.save(tab.id)).toBe(true);
  await flushPromises();
  expect(tab).toMatchObject({ text: "saved\n", hunks: savedHunks, loadGeneration: generation });
});

it("never attaches saved line numbers to a newer draft", async () => {
  const { store, tab } = await setup();
  const read = deferred();
  mocks.diffFile.mockReturnValueOnce(read.promise);
  const saving = store.save(tab.id);
  await flushPromises();
  store.setDocument(tab.id, "new line\nsaved\n");
  read.resolve(diff("saved\n"));
  await saving;
  await flushPromises();
  expect(tab).toMatchObject({
    text: "new line\nsaved\n",
    baseline: "saved\n",
    dirty: true,
    hunks: [],
  });
});

it.each(["navigation", "reopen", "move", "dispose"])(
  "drops an in-flight result and queued read after %s",
  async (action) => {
    const { store, tab } = await setup();
    const read = deferred();
    mocks.diffFile.mockReturnValueOnce(read.promise);
    const first = store.save(tab.id);
    await flushPromises();
    store.setDocument(tab.id, "latest\n");
    const second = store.save(tab.id);
    await flushPromises();
    if (action === "navigation") mocks.workspace.token++;
    if (action === "reopen") {
      store.closeTab(tab.id);
      await store.open("note.txt");
      mocks.diffFile.mockClear();
    }
    if (action === "move") {
      store.applyFileMutation("C:/repo", "move", [{ path: "note.txt", destination: "moved.txt" }]);
      store.applyFileMutation("C:/repo", "move", [{ path: "moved.txt", destination: "note.txt" }]);
    }
    if (action === "dispose") store.$dispose();
    const calls = mocks.diffFile.mock.calls.length;
    read.resolve(diff("saved\n"));
    const results = await Promise.all([first, second]);
    await flushPromises();
    expect(mocks.diffFile).toHaveBeenCalledTimes(calls);
    expect(results).toEqual([true, true]);
    if (action === "reopen") expect(store.tabs[0]!.hunks).toEqual(initialHunks);
    else expect(tab.hunks).toEqual([]);
  },
);

it("does not publish an older read while a new disk write is still pending", async () => {
  const { store, tab } = await setup();
  const read = deferred();
  const write = deferred();
  mocks.diffFile.mockReturnValueOnce(read.promise).mockResolvedValue(diff("latest\n"));
  const first = store.save(tab.id);
  await flushPromises();
  store.setDocument(tab.id, "latest\n");
  mocks.fileWriteWorktree.mockReturnValueOnce(write.promise);
  const second = store.save(tab.id);
  await flushPromises();
  read.resolve(diff("saved\n"));
  await flushPromises();
  const beforeWrite = { saving: tab.saving, hunks: [...tab.hunks] };
  write.resolve(null);
  await Promise.all([first, second]);
  await flushPromises();
  expect(beforeWrite).toEqual({ saving: true, hunks: [] });
  expect(tab).toMatchObject({
    baseline: "latest\n",
    dirty: false,
    saving: false,
    hunks: savedHunks,
  });
});

it("clears obsolete marks when the new saved file is too large for optional diff", async () => {
  const { store, tab } = await setup();
  store.setDocument(tab.id, "x".repeat(5 * 1024 * 1024 + 1));
  expect(await store.save(tab.id)).toBe(true);
  expect(tab.hunks).toEqual([]);
  expect(mocks.diffFile).not.toHaveBeenCalled();
});

it("keeps the write lock, draft and original marks on write failure and allows retry", async () => {
  const { store, tab } = await setup();
  const write = deferred();
  mocks.fileWriteWorktree.mockReturnValueOnce(write.promise);
  const saving = store.save(tab.id);
  expect(await store.save(tab.id)).toBe(false);
  expect(tab.saving).toBe(true);
  write.reject(new Error("file locked"));
  expect(await saving).toBe(false);
  expect(tab).toMatchObject({
    text: "saved\n",
    baseline: "initial\n",
    dirty: true,
    saving: false,
    hunks: initialHunks,
  });
  expect(mocks.diffFile).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledOnce();
  mocks.diffFile.mockResolvedValue(diff("saved\n"));
  expect(await store.save(tab.id)).toBe(true);
});
