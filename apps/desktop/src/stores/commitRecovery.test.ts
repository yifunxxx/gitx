import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useCommitStore } from "./commitStore";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  backend: { commitCreate: vi.fn() },
  changes: { stagingMode: true, checkedPaths: [], setChecked: vi.fn(), refresh: vi.fn() },
  rewrite: { refreshOpState: vi.fn() },
  toast: vi.fn(),
}));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("./rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("./branchesStore", () => ({ useBranchesStore: () => ({ refresh: vi.fn() }) }));
vi.mock("./logStore", () => ({ useLogStore: () => ({ load: vi.fn() }) }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));

let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  mocks.workspace = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    navigationToken: () => 1,
  });
});
afterEach(() => disposePinia(pinia));

it("retains successful commit identity and shows a persistent recovery warning", async () => {
  const result = {
    sha: "123456789",
    subject: "merged",
    amended: false,
    warning: "Commit succeeded. Local changes need attention",
  };
  mocks.backend.commitCreate.mockResolvedValue(result);
  const store = useCommitStore();
  store.message = "merge";
  expect(await store.commit()).toEqual(result);
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
    title: "Committed",
    description: result.warning,
    persistent: true,
  });
  expect(store.message).toBe("");
  expect(store.committing).toBe(false);
  expect(mocks.rewrite.refreshOpState).toHaveBeenCalledOnce();
  expect(mocks.changes.refresh).toHaveBeenCalledOnce();
});

it("does not report a committed operation as failed when status refresh fails", async () => {
  const result = { sha: "123456789", subject: "merged", amended: false };
  mocks.backend.commitCreate.mockResolvedValue(result);
  mocks.rewrite.refreshOpState.mockRejectedValue(new Error("refresh failed"));
  const store = useCommitStore();
  store.message = "merge";
  expect(await store.commit()).toEqual(result);
  expect(mocks.toast).toHaveBeenCalledOnce();
  expect(mocks.toast.mock.calls[0][0].title).toBe("Committed");
});

it("keeps the draft on a failed commit without starting recovery refresh", async () => {
  mocks.backend.commitCreate.mockRejectedValue(new Error("commit failed"));
  const store = useCommitStore();
  store.message = "merge";
  await expect(store.commit()).rejects.toThrow("commit failed");
  expect(store.message).toBe("merge");
  expect(store.committing).toBe(false);
  expect(mocks.rewrite.refreshOpState).not.toHaveBeenCalled();
});
