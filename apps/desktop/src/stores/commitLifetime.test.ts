import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useCommitStore } from "./commitStore";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  changes: {} as any,
  backend: { commitCreate: vi.fn(), commitHeadMessage: vi.fn() },
  rewrite: { busy: false, refreshOpState: vi.fn() },
  branches: { refresh: vi.fn() },
  log: { load: vi.fn() },
  toast: vi.fn(),
}));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("./rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("./branchesStore", () => ({ useBranchesStore: () => mocks.branches }));
vi.mock("./logStore", () => ({ useLogStore: () => mocks.log }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const committed = { sha: "123456789", subject: "saved", amended: false };
const key = (path: string) => `gitx.commitDraft.${path}`;
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  mocks.workspace = reactive({
    repoPath: "A",
    repoId: "id-A",
    isRepo: true,
    navigation: 1,
    navigationToken() {
      return this.navigation;
    },
  });
  mocks.changes = reactive({
    stagingMode: false,
    checkedPaths: ["first.txt"],
    setChecked: vi.fn(),
    refresh: vi.fn(),
  });
  mocks.rewrite.busy = false;
});
afterEach(() => {
  disposePinia(pinia);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const invalidations = [
  ["navigation starts", () => ++mocks.workspace.navigation],
  [
    "A to B to A",
    () => {
      mocks.workspace.repoPath = "B";
      mocks.workspace.repoPath = "A";
    },
  ],
  [
    "same-path repository identity",
    () => {
      mocks.workspace.repoId = "replacement-A";
    },
  ],
  [
    "repository becomes unavailable",
    () => {
      mocks.workspace.isRepo = false;
    },
  ],
  ["store disposal", () => useCommitStore().$dispose()],
] as const;

it("saves drafts to their owner even when typing and navigation share a tick", async () => {
  localStorage.setItem(key("B"), "draft B");
  const store = useCommitStore();
  store.message = "new draft A";
  mocks.workspace.repoPath = "B";
  await flushPromises();
  expect(store.message).toBe("draft B");
  expect(localStorage.getItem(key("A"))).toBe("new draft A");
  expect(localStorage.getItem(key("B"))).toBe("draft B");
});

it.each(invalidations)(
  "does not clear, notify, or refresh a newer session after %s",
  async (_label, invalidate) => {
    const store = useCommitStore();
    store.message = "submitted A";
    const pending = deferred<typeof committed>();
    mocks.backend.commitCreate.mockReturnValue(pending.promise);
    const operation = store.commit();
    invalidate();
    store.message = "current draft";
    await flushPromises();
    mocks.toast.mockClear();
    pending.resolve(committed);
    expect(await operation).toEqual(committed);
    expect(store.message).toBe("current draft");
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.changes.setChecked).not.toHaveBeenCalled();
    expect(mocks.changes.refresh).not.toHaveBeenCalled();
    expect(mocks.rewrite.refreshOpState).not.toHaveBeenCalled();
    expect(mocks.log.load).not.toHaveBeenCalled();
  },
);

it.each(invalidations)(
  "does not report an old commit failure in the new session after %s",
  async (_label, invalidate) => {
    const store = useCommitStore();
    store.message = "submitted A";
    const pending = deferred<typeof committed>();
    mocks.backend.commitCreate.mockReturnValue(pending.promise);
    const operation = store.commit();
    invalidate();
    store.message = "current draft";
    pending.reject(new Error("old hook failure"));
    await expect(operation).rejects.toThrow("old hook failure");
    expect(store.message).toBe("current draft");
    expect(mocks.toast).not.toHaveBeenCalled();
  },
);

it("blocks repeated submission, including returning to the same repository while it runs", async () => {
  const store = useCommitStore();
  store.message = "submitted A";
  const pending = deferred<typeof committed>();
  mocks.backend.commitCreate.mockReturnValue(pending.promise);
  const operation = store.commit();
  await store.commit();
  mocks.workspace.repoPath = "B";
  mocks.workspace.repoPath = "A";
  store.message = "another A";
  await store.commit();
  expect(mocks.backend.commitCreate).toHaveBeenCalledOnce();
  pending.resolve(committed);
  await operation;
  expect(store.committing).toBe(false);
});

it("finishing a previous repository does not unlock the current repository's commit", async () => {
  const store = useCommitStore();
  store.message = "submitted A";
  const a = deferred<typeof committed>();
  const b = deferred<typeof committed>();
  mocks.backend.commitCreate.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const operationA = store.commit();
  mocks.workspace.repoPath = "B";
  mocks.workspace.repoId = "id-B";
  store.message = "submitted B";
  const operationB = store.commit();
  expect(mocks.backend.commitCreate).toHaveBeenCalledTimes(2);
  a.resolve(committed);
  await operationA;
  expect(store.committing).toBe(true);
  expect(store.message).toBe("submitted B");
  b.resolve(committed);
  await operationB;
  expect(store.committing).toBe(false);
});

it.each([false, true])(
  "retains edits made during submission, even if text returns to its original value: %s",
  async (sameText) => {
    const store = useCommitStore();
    store.message = "submitted";
    const pending = deferred<typeof committed>();
    mocks.backend.commitCreate.mockReturnValue(pending.promise);
    const operation = store.commit();
    store.message = "new draft";
    if (sameText) store.message = "submitted";
    pending.resolve(committed);
    await operation;
    expect(store.message).toBe(sameText ? "submitted" : "new draft");
    expect(localStorage.getItem(key("A"))).toBe(store.message);
    expect(mocks.backend.commitCreate.mock.calls[0][0].message).toBe("submitted");
  },
);

it("does not clear a newer file selection after a successful commit", async () => {
  const store = useCommitStore();
  store.message = "submitted";
  const pending = deferred<typeof committed>();
  mocks.backend.commitCreate.mockReturnValue(pending.promise);
  const operation = store.commit();
  mocks.changes.checkedPaths = ["next.txt"];
  pending.resolve(committed);
  await operation;
  expect(mocks.changes.setChecked).not.toHaveBeenCalled();
  expect(mocks.backend.commitCreate.mock.calls[0][0].paths).toEqual(["first.txt"]);
});

it("marks Amend selected during loading but prevents a commit before the head message is ready", async () => {
  const store = useCommitStore();
  store.message = "ordinary draft";
  const pending = deferred<string>();
  mocks.backend.commitHeadMessage.mockReturnValue(pending.promise);
  const operation = store.setAmend(true);
  expect(store.amend).toBe(true);
  await store.commit();
  expect(mocks.backend.commitCreate).not.toHaveBeenCalled();
  pending.resolve("HEAD subject\n\nHEAD body\n");
  await operation;
  expect(store.message).toBe("HEAD subject\n\nHEAD body\n");
  expect(localStorage.getItem(key("A"))).toBe("ordinary draft");
  await store.setAmend(false);
  expect(store.message).toBe("ordinary draft");
});

it("cancels a pending Amend load immediately when it is unchecked", async () => {
  const store = useCommitStore();
  store.message = "ordinary draft";
  const pending = deferred<string>();
  mocks.backend.commitHeadMessage.mockReturnValue(pending.promise);
  const operation = store.setAmend(true);
  await store.setAmend(false);
  pending.resolve("old HEAD message");
  await operation;
  expect(store.amend).toBe(false);
  expect(store.message).toBe("ordinary draft");
});

it("keeps manual edits typed while Amend is loading", async () => {
  const store = useCommitStore();
  store.message = "ordinary draft";
  const pending = deferred<string>();
  mocks.backend.commitHeadMessage.mockReturnValue(pending.promise);
  const operation = store.setAmend(true);
  store.message = "manual amend text";
  pending.resolve("HEAD message");
  await operation;
  expect(store.message).toBe("manual amend text");
});

it.each(invalidations)("ignores an old Amend message after %s", async (_label, invalidate) => {
  const store = useCommitStore();
  store.message = "ordinary draft";
  const pending = deferred<string>();
  mocks.backend.commitHeadMessage.mockReturnValue(pending.promise);
  const operation = store.setAmend(true);
  invalidate();
  store.message = "current draft";
  pending.resolve("old HEAD message");
  await operation;
  expect(store.message).toBe("current draft");
});

it("blocks Amend after a load failure and supports retry without losing the ordinary draft", async () => {
  const store = useCommitStore();
  store.message = "ordinary draft";
  mocks.backend.commitHeadMessage
    .mockRejectedValueOnce(new Error("HEAD is unavailable"))
    .mockResolvedValueOnce("HEAD message");
  await store.setAmend(true);
  await store.commit();
  expect(mocks.backend.commitCreate).not.toHaveBeenCalled();
  await store.setAmend(true);
  expect(mocks.backend.commitHeadMessage).toHaveBeenCalledTimes(2);
  expect(store.message).toBe("HEAD message");
  await store.setAmend(false);
  expect(store.message).toBe("ordinary draft");
});

it("does not change Amend mode while a commit is running", async () => {
  const store = useCommitStore();
  store.message = "submitted";
  const pending = deferred<typeof committed>();
  mocks.backend.commitCreate.mockReturnValue(pending.promise);
  const operation = store.commit();
  await store.setAmend(true);
  expect(mocks.backend.commitHeadMessage).not.toHaveBeenCalled();
  expect(store.amend).toBe(false);
  pending.resolve(committed);
  await operation;
});

it("restores the unused ordinary draft after a successful Amend", async () => {
  const store = useCommitStore();
  store.message = "ordinary draft";
  mocks.backend.commitHeadMessage.mockResolvedValue("HEAD message");
  await store.setAmend(true);
  mocks.backend.commitCreate.mockResolvedValue({ ...committed, amended: true });
  await store.commit();
  expect(store.amend).toBe(false);
  expect(store.message).toBe("ordinary draft");
  expect(localStorage.getItem(key("A"))).toBe("ordinary draft");
});

it("keeps session drafts and warns once when persistent storage is unavailable", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("full");
    },
  });

  const store = useCommitStore();
  store.message = "draft A";
  store.message = "new draft A";
  expect(mocks.toast).toHaveBeenCalledOnce();
  mocks.workspace.repoPath = "B";
  store.message = "draft B";
  mocks.workspace.repoPath = "A";
  expect(store.message).toBe("new draft A");
  expect(mocks.toast).toHaveBeenCalledTimes(2);
});

it("does not misreport success when removing the saved draft fails", async () => {
  const store = useCommitStore();
  store.message = "submitted";
  vi.stubGlobal("localStorage", {
    getItem: localStorage.getItem.bind(localStorage),
    setItem: localStorage.setItem.bind(localStorage),
    removeItem: () => {
      throw new Error("blocked");
    },
  });
  mocks.backend.commitCreate.mockResolvedValue(committed);
  expect(await store.commit()).toEqual(committed);
  expect(store.message).toBe("");
  expect(mocks.toast.mock.calls.map(([value]) => value.title)).not.toContain("Commit failed");
  mocks.workspace.repoPath = "B";
  mocks.workspace.repoPath = "A";
  expect(store.message).toBe("");
});

it("blocks commit and Amend changes while a history rewrite is active", async () => {
  const store = useCommitStore();
  store.message = "draft";
  mocks.rewrite.busy = true;
  await store.commit();
  await store.setAmend(true);
  expect(mocks.backend.commitCreate).not.toHaveBeenCalled();
  expect(mocks.backend.commitHeadMessage).not.toHaveBeenCalled();
});

it("handles synchronous refresh failures without reporting a committed change as failed", async () => {
  const store = useCommitStore();
  store.message = "draft";
  mocks.backend.commitCreate.mockResolvedValue(committed);
  mocks.changes.refresh.mockImplementation(() => {
    throw new Error("refresh error");
  });
  expect(await store.commit()).toEqual(committed);
  expect(mocks.toast).toHaveBeenCalledOnce();
  expect(mocks.toast.mock.calls[0][0].title).toBe("Committed");
});
