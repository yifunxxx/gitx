import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useSyncStore } from "./syncStore";

const m = vi.hoisted(() => ({
  ws: {} as any,
  update: vi.fn(),
  refresh: vi.fn(),
  conflicts: vi.fn(),
  op: vi.fn(),
  stash: vi.fn(),
  toast: vi.fn(),
  auth: vi.fn(),
  finished: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ updateProjectRun: m.update }) }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => m.ws }));
vi.mock("./branchesStore", () => ({
  useBranchesStore: () => ({ refresh: m.refresh, remotes: [] }),
}));
vi.mock("./changesStore", () => ({ useChangesStore: () => ({ refresh: m.refresh }) }));
vi.mock("./logStore", () => ({ useLogStore: () => ({ load: m.refresh }) }));
vi.mock("./conflictsStore", () => ({ useConflictsStore: () => ({ refresh: m.conflicts }) }));
vi.mock("./rewriteStore", () => ({ useRewriteStore: () => ({ refreshOpState: m.op }) }));
vi.mock("./stashShelfStore", () => ({ useStashShelfStore: () => ({ refresh: m.stash }) }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => ({}) }));
vi.mock("./jobsStore", () => ({
  useJobsStore: () => ({ started: vi.fn(), progress: vi.fn(), finished: m.finished }),
}));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/composables/useCredentials", () => ({ handleAuthFailure: m.auth }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (s: string) => s } } }));

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  m.ws = reactive({ repoPath: "/repo", navigationToken: () => 1 });
  m.auth.mockResolvedValue(false);
});

it("refreshes recovery state after an update conflict without retrying or offering credentials", async () => {
  const error = { code: "mergeConflict", message: "Saved local changes remain in Stash (abc123)" };
  m.update.mockRejectedValue(error);
  m.conflicts.mockRejectedValue(new Error("refresh failure"));
  const store = useSyncStore();
  await expect(store.updateProject("rebase")).rejects.toBe(error);
  expect(m.update).toHaveBeenCalledOnce();
  expect(m.refresh).toHaveBeenCalledTimes(3);
  expect(m.conflicts).toHaveBeenCalledOnce();
  expect(m.op).toHaveBeenCalledOnce();
  expect(m.stash).toHaveBeenCalledOnce();
  expect(m.toast).toHaveBeenCalledWith(
    expect.objectContaining({ description: error.message, action: undefined }),
  );
  expect(store.updating).toBe(false);
  expect(m.finished).toHaveBeenCalledOnce();
});

it("does not refresh another repository when an old update fails", async () => {
  let fail!: (reason: unknown) => void;
  m.update.mockReturnValue(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  const store = useSyncStore();
  const request = store.updateProject("rebase");
  m.ws.repoPath = "/other";
  fail({ code: "rebaseConflict", message: "old update" });
  await expect(request).rejects.toMatchObject({ code: "rebaseConflict" });
  expect(m.refresh).not.toHaveBeenCalled();
  expect(m.stash).not.toHaveBeenCalled();
});
