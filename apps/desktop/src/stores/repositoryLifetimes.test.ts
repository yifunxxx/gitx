import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useWorkspaceStore } from "./workspaceStore";
import { useBranchesStore } from "./branchesStore";
import { useWorktreesStore } from "./worktreesStore";
import { useStashShelfStore } from "./stashShelfStore";
import { useConflictsStore } from "./conflictsStore";
import { useCommitStore } from "./commitStore";
import { useSyncStore } from "./syncStore";
import { useLayoutStore } from "./layoutStore";
import { useRewriteStore } from "./rewriteStore";

const mocks = vi.hoisted(() => ({
  backend: {
    workspaceOpen: vi.fn(),
    workspaceRecent: vi.fn(),
    refsList: vi.fn(),
    remoteList: vi.fn(),
    worktreeList: vi.fn(),
    worktreeAdd: vi.fn(),
    worktreeOpenRef: vi.fn(),
    worktreeRemove: vi.fn(),
    stashList: vi.fn(),
    shelfList: vi.fn(),
    shelfListDeleted: vi.fn(),
    conflictsList: vi.fn(),
    conflictMerge3: vi.fn(),
    conflictSaveResult: vi.fn(),
    commitHeadMessage: vi.fn(),
    commitCreate: vi.fn(),
    pullRun: vi.fn(),
    updateProjectRun: vi.fn(),
    fetchRun: vi.fn(),
    lsRemoteCheck: vi.fn(),
    mergeRun: vi.fn(),
    repoOpStateGet: vi.fn(),
    undoRewrite: vi.fn(),
    rewordCommit: vi.fn(),
  },
  changes: { refresh: vi.fn(), setChecked: vi.fn(), stagingMode: false, checkedPaths: [] },
  log: { load: vi.fn() },
  auth: vi.fn(),
  dialog: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("./logStore", () => ({ useLogStore: () => mocks.log }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/composables/useCredentials", () => ({ handleAuthFailure: mocks.auth }));
vi.mock("@/composables/useDialog", () => ({
  openDialog: mocks.dialog,
  useDialogStack: () => ({ value: [] }),
}));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: vi.fn() }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const openResult = (path: string) => ({
  path,
  isRepo: true,
  toplevel: path,
  gitDir: `${path}/.git`,
  commonDir: `${path}/.git`,
  roots: [],
});
const undoHead = { oid: "rewritten-head", symbolicRef: "refs/heads/main" };

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  localStorage.clear();
  mocks.backend.workspaceOpen.mockImplementation(async ({ path }) => openResult(path));
  mocks.backend.workspaceRecent.mockResolvedValue({ paths: [] });
  mocks.backend.remoteList.mockResolvedValue([]);
  mocks.backend.refsList.mockResolvedValue({
    local: [],
    remote: [],
    tags: [],
    current: "main",
    recent: [],
  });
  mocks.backend.shelfList.mockResolvedValue([]);
});

describe("repository identity and late responses", () => {
  it.each(["failed", "skipped", "error", "updated"])(
    "shows submodule %s results even when the parent HEAD has not changed",
    async (status) => {
      await useWorkspaceStore().openFolder("A");
      const info = {
        oldHead: "parent",
        newHead: "parent",
        strategy: "merge",
        message: "All files are up-to-date",
        updatedFiles: [],
        commits: [],
        submoduleError: status === "error" ? "invalid .gitmodules" : null,
        submodules:
          status === "error"
            ? null
            : {
                message: "module results",
                items: [
                  {
                    path: "libs/module 中文",
                    oldSha: "old",
                    newSha: status === "updated" ? "new" : "old",
                    updated: status === "updated",
                    skipped: status === "skipped",
                    onBranch: null,
                    message: "local module detail",
                  },
                ],
              },
      };
      mocks.backend.updateProjectRun.mockResolvedValue(info);
      const sync = useSyncStore();
      await sync.updateProject("merge");
      expect(sync.lastUpdate).toEqual(info);
      expect(useLayoutStore().activeBottomTab).toBe("update");
      expect(useLayoutStore().bottomOpen).toBe(true);
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title:
            status === "updated" ? "syncUi.submodulesTitle" : "syncUi.updateSubmodulesIncomplete",
          description: expect.stringContaining(
            status === "error" ? "invalid .gitmodules" : "syncUi.submodulesSummary",
          ),
          persistent: true,
        }),
      );
      expect(mocks.auth).not.toHaveBeenCalled();
    },
  );

  it("ignores late submodule update results after A → B → A and prevents duplicate submission", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const sync = useSyncStore();
    const pendingResult = deferred<unknown>();
    mocks.backend.updateProjectRun.mockReturnValue(pendingResult.promise);
    const pending = sync.updateProject("merge");
    await sync.updateProject("merge");
    expect(mocks.backend.updateProjectRun).toHaveBeenCalledOnce();
    await ws.openFolder("B");
    await ws.openFolder("A");
    mocks.changes.refresh.mockClear();
    pendingResult.resolve({ oldHead: "old", newHead: "new", submoduleError: "late error" });
    await pending;
    expect(sync.lastUpdate).toBeNull();
    expect(sync.updating).toBe(false);
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.changes.refresh).not.toHaveBeenCalled();
  });

  it("invalidates dialog navigation tokens when switching workspace roots A → B → A", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("workspace");
    ws.roots = ["A", "B"].map((path) => ({
      id: path,
      worktreeRoot: path,
      gitDir: `${path}/.git`,
      commonDir: `${path}/.git`,
      isWorktree: false,
      displayName: path,
      color: "blue",
      isSubmodule: false,
    }));
    ws.setActiveRepo("A");
    const before = ws.navigationToken();
    ws.setActiveRepo("B");
    ws.setActiveRepo("A");
    expect(ws.repoPath).toBe("A");
    expect(ws.navigationToken()).not.toBe(before);
    const current = ws.navigationToken();
    ws.setActiveRepo("A");
    expect(ws.navigationToken()).toBe(current);
  });
  it("refreshes recent repositories after a removal finishes in another workspace", async () => {
    const ws = useWorkspaceStore();
    mocks.backend.workspaceRecent.mockResolvedValue({ paths: ["removed", "A"] });
    await ws.openFolder("A");
    const completion = deferred<void>();
    mocks.backend.worktreeRemove.mockReturnValueOnce(completion.promise);
    const pending = useWorktreesStore().remove("removed", false);
    await ws.openFolder("B");
    mocks.backend.workspaceRecent.mockResolvedValue({ paths: ["B", "A"] });
    completion.resolve();
    await pending;
    expect(ws.recent).toEqual(["B", "A"]);
    expect(ws.repoPath).toBe("B");
    expect(mocks.backend.worktreeList).not.toHaveBeenCalled();
  });

  it("keeps recent repositories when worktree removal fails", async () => {
    const ws = useWorkspaceStore();
    mocks.backend.workspaceRecent.mockResolvedValue({ paths: ["dirty-worktree", "A"] });
    await ws.openFolder("A");
    mocks.backend.workspaceRecent.mockClear();
    mocks.backend.worktreeRemove.mockRejectedValueOnce(new Error("contains modified files"));
    await useWorktreesStore().remove("dirty-worktree", false);
    expect(ws.recent).toEqual(["dirty-worktree", "A"]);
    expect(mocks.backend.workspaceRecent).not.toHaveBeenCalled();
  });

  it("does not restore a removed recent repository from a late list response", async () => {
    const ws = useWorkspaceStore();
    const old = deferred<{ paths: string[] }>();
    mocks.backend.workspaceRecent.mockReturnValueOnce(old.promise);
    const pending = ws.loadRecent();
    mocks.backend.workspaceRecent.mockResolvedValueOnce({ paths: ["current"] });
    await ws.loadRecent();
    old.resolve({ paths: ["removed", "current"] });
    await pending;
    expect(ws.recent).toEqual(["current"]);
  });

  it("keeps undo disabled during refresh and after repository navigation", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const refresh = deferred<unknown>();
    mocks.backend.repoOpStateGet.mockReturnValueOnce(refresh.promise);
    mocks.backend.rewordCommit.mockResolvedValue({
      outcome: "success",
      backupRef: "refs/gitx/backup/reword-1",
      undoHead,
      message: "Reworded",
    });
    const pending = useRewriteStore().reword("old", "message");
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());
    const action = mocks.toast.mock.calls[0]![0].action;
    expect(action.disabled()).toBe(true);
    expect(action.onClick()).toBe(false);
    expect(mocks.backend.undoRewrite).not.toHaveBeenCalled();
    refresh.resolve({ kind: "normal" });
    await pending;
    expect(action.disabled()).toBe(false);
    expect(useRewriteStore().canUndo).toBe(true);
    await ws.openFolder("B");
    expect(useRewriteStore().canUndo).toBe(false);
    expect(action.disabled()).toBe(true);
    expect(action.onClick()).toBe(false);
    expect(mocks.backend.undoRewrite).not.toHaveBeenCalled();
  });
  it("does not show an old undo result or backup in another repository", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const result = deferred<unknown>();
    mocks.backend.undoRewrite.mockReturnValue(result.promise);
    const rewrite = useRewriteStore();
    const pending = rewrite.undoLast("refs/gitx/backup/reset-1", undoHead);
    await ws.openFolder("B");
    result.resolve({ backupRef: "refs/gitx/backup/undo-2", message: "old result" });
    await pending;
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(rewrite.lastBackupRef).toBeNull();
    expect(mocks.backend.repoOpStateGet).not.toHaveBeenCalled();
  });
  it("refreshes actual state after a partially completed undo reports an error", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    mocks.backend.repoOpStateGet.mockResolvedValue({ kind: "normal" });
    mocks.backend.undoRewrite.mockRejectedValue(new Error("snapshot restoration failed"));
    await expect(useRewriteStore().undoLast("refs/gitx/backup/reset-1", undoHead)).rejects.toThrow(
      "snapshot restoration failed",
    );
    expect(mocks.backend.repoOpStateGet).toHaveBeenCalledWith({ path: "A" });
    expect(mocks.changes.refresh).toHaveBeenCalledOnce();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("shows undo-action failures instead of leaving an unhandled rejection", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    mocks.backend.repoOpStateGet.mockResolvedValue({ kind: "normal" });
    mocks.backend.rewordCommit.mockResolvedValue({
      outcome: "success",
      backupRef: "refs/gitx/backup/reword-1",
      undoHead,
      message: "Reworded",
    });
    await useRewriteStore().reword("old", "message");
    mocks.backend.undoRewrite.mockRejectedValue(new Error("local work would be overwritten"));
    mocks.toast.mock.calls[0]![0].action.onClick();
    await vi.waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "rewrite.undoFailed",
          description: expect.stringContaining("local work would be overwritten"),
        }),
      ),
    );
  });
  it("keeps each undo action bound to its own HEAD and localizes an expired action", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    mocks.backend.repoOpStateGet.mockResolvedValue({ kind: "normal" });
    mocks.backend.rewordCommit
      .mockResolvedValueOnce({
        outcome: "success",
        backupRef: "refs/gitx/backup/first",
        undoHead,
      })
      .mockResolvedValueOnce({
        outcome: "success",
        backupRef: "refs/gitx/backup/second",
        undoHead: { oid: "later-head", symbolicRef: "refs/heads/main" },
      });
    const rewrite = useRewriteStore();
    await rewrite.reword("old", "first");
    const firstAction = mocks.toast.mock.calls[0]![0].action;
    await rewrite.reword("new", "second");
    mocks.backend.undoRewrite.mockRejectedValue({ code: "staleUndo", message: "HEAD changed" });
    firstAction.onClick();
    await vi.waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        title: "rewrite.undoFailed",
        description: "rewrite.staleUndo",
        persistent: true,
      }),
    );
    expect(mocks.backend.undoRewrite).toHaveBeenCalledWith({
      path: "A",
      backupRef: "refs/gitx/backup/first",
      restoreWorktree: true,
      expectedHead: undoHead,
    });
    expect(rewrite.lastBackupRef).toBe("refs/gitx/backup/second");
  });
  it("does not offer or execute undo without its original HEAD identity", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    mocks.backend.repoOpStateGet.mockResolvedValue({ kind: "normal" });
    mocks.backend.rewordCommit.mockResolvedValue({
      outcome: "success",
      backupRef: "refs/gitx/backup/old",
    });
    const rewrite = useRewriteStore();
    await rewrite.reword("old", "message");
    expect(mocks.toast.mock.calls[0]![0].action).toBeUndefined();
    await expect(rewrite.undoLast()).rejects.toThrow("rewrite.undoUnavailable");
    expect(mocks.backend.undoRewrite).not.toHaveBeenCalled();
  });
  it("does not open a completed worktree after a newer folder navigation starts", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const create = deferred<unknown>();
    mocks.backend.worktreeAdd.mockReturnValue(create.promise);
    const worktrees = useWorktreesStore();
    const pending = worktrees.create({
      worktreePath: "A-feature",
      startRef: "HEAD",
      newBranch: "feature",
    });
    expect(worktrees.busy).toBe(true);
    const open = deferred<unknown>();
    mocks.backend.workspaceOpen.mockReturnValueOnce(open.promise);
    const navigation = ws.openFolder("B");
    create.resolve({ worktreePath: "A-feature", openAfter: true });
    await pending;
    expect(mocks.backend.workspaceOpen.mock.calls.map((c) => c[0].path)).toEqual(["A", "B"]);
    expect(mocks.backend.worktreeList).not.toHaveBeenCalled();
    open.resolve(openResult("B"));
    await navigation;
    expect(ws.repoPath).toBe("B");
    expect(worktrees.busy).toBe(false);
  });
  it("does not open a fetched ref after switching A to B to A", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const result = deferred<unknown>();
    mocks.backend.worktreeOpenRef.mockReturnValue(result.promise);
    const store = useWorktreesStore();
    const pending = store.openRef({
      worktreePath: "review",
      refspec: "topic",
      remote: "origin",
      reviewName: "topic",
    });
    await ws.openFolder("B");
    await ws.openFolder("A");
    result.resolve({ worktreePath: "review", openAfter: true });
    await pending;
    expect(ws.repoPath).toBe("A");
    expect(mocks.backend.worktreeList).not.toHaveBeenCalled();
    expect(mocks.backend.workspaceOpen).toHaveBeenCalledTimes(3);
  });
  it("opens only one conflict dialog after a conflicted merge", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    mocks.backend.mergeRun.mockResolvedValue({
      outcome: "conflicts",
      conflictFiles: ["file"],
      backupRef: null,
    });
    mocks.backend.repoOpStateGet.mockResolvedValue({ kind: "merge", conflictCount: 1 });
    mocks.backend.conflictsList.mockResolvedValue({ entries: [{ path: "file" }] });
    await useRewriteStore().merge({ branches: ["feature"] });
    expect(mocks.dialog).toHaveBeenCalledOnce();
  });
  it("keeps pull file and commit details from the backend", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const updatedFiles = [{ path: "remote.txt", status: "A", origPath: null }];
    const commits = ["abcdef1 Remote update"];
    mocks.backend.pullRun.mockResolvedValue({
      oldHead: "old",
      newHead: "new",
      updated: true,
      strategy: "merge",
      message: "Pulled",
      updatedFiles,
      commits,
    });
    const sync = useSyncStore();
    await sync.pull({ remote: "origin", branch: "main" });
    expect(sync.lastUpdate).toMatchObject({ updatedFiles, commits });
  });

  it("does not retry a fetch after A → B → A while credentials are open", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const store = useBranchesStore();
    const prompt = deferred<boolean>();
    mocks.auth.mockReturnValueOnce(prompt.promise);
    const error = new Error("Authentication failed");
    mocks.backend.fetchRun.mockRejectedValueOnce(error);
    const pending = store.fetch("origin");
    const failed = expect(pending).rejects.toBe(error);
    await vi.waitFor(() => expect(mocks.auth).toHaveBeenCalledOnce());
    await ws.openFolder("B");
    await ws.openFolder("A");
    prompt.resolve(true);
    await failed;
    expect(mocks.backend.fetchRun).toHaveBeenCalledTimes(1);
    expect(store.lastFetchAt).toBeNull();
    expect(store.fetching).toBe(false);
  });

  it("ignores a previous repository's incoming check", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const store = useBranchesStore();
    store.remotes = [{ name: "origin", fetchUrl: "https://example.invalid/A", pushUrl: null }];
    const old = deferred<unknown>();
    mocks.backend.lsRemoteCheck.mockReturnValueOnce(old.promise);
    const pending = store.checkIncoming();
    await ws.openFolder("B");
    old.resolve({ hasUnfetched: true });
    await pending;
    expect(store.hasUnfetched).toBe(false);
  });
  it("never retries a pull against a newly selected repository after credentials", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const prompt = deferred<boolean>();
    mocks.auth.mockReturnValueOnce(prompt.promise);
    const error = new Error("Authentication failed");
    mocks.backend.pullRun.mockRejectedValueOnce(error);
    const pending = useSyncStore().pull({ remote: "origin", branch: "main" });
    const failed = expect(pending).rejects.toBe(error);
    await vi.waitFor(() => expect(mocks.auth).toHaveBeenCalledOnce());
    await ws.openFolder("B");
    prompt.resolve(true);
    await failed;
    expect(mocks.backend.pullRun).toHaveBeenCalledTimes(1);
    expect(mocks.backend.pullRun.mock.calls[0]![0].path).toBe("A");
  });

  it("does not restart a smart merge after the user switches repositories", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const dialog = deferred<string>();
    mocks.dialog.mockReturnValueOnce(dialog.promise);
    mocks.backend.mergeRun.mockRejectedValueOnce({ code: "dirtyWorktreeWouldBeOverwritten" });
    const pending = useRewriteStore().merge({ branches: ["feature"] });
    await vi.waitFor(() => expect(mocks.dialog).toHaveBeenCalledOnce());
    await ws.openFolder("B");
    dialog.resolve("smart");
    await pending;
    expect(mocks.backend.mergeRun).toHaveBeenCalledTimes(1);
    expect(mocks.backend.mergeRun.mock.calls[0]![0].path).toBe("A");
  });

  it("does not apply a previous repository's merge state after its command completes", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const store = useRewriteStore();
    const old = deferred<unknown>();
    mocks.backend.mergeRun.mockReturnValueOnce(old.promise);
    const pending = store.merge({ branches: ["feature"] });
    await ws.openFolder("B");
    old.resolve({ outcome: "conflicts", backupRef: "old-backup", message: "conflicts" });
    await pending;
    expect(store.lastBackupRef).toBeNull();
    expect(store.opState).toBeNull();
    expect(store.busy).toBe(false);
    expect(mocks.backend.conflictsList).not.toHaveBeenCalled();
    expect(mocks.dialog).not.toHaveBeenCalled();
  });
  it("keeps the latest folder when opening two repositories concurrently", async () => {
    const ws = useWorkspaceStore();
    const old = deferred<unknown>();
    mocks.backend.workspaceOpen.mockReturnValueOnce(old.promise);
    const pending = ws.openFolder("old");
    await ws.openFolder("current");
    old.resolve(openResult("old"));
    await pending;
    expect(ws.repoPath).toBe("current");
    expect(ws.gitDir).toBe("current/.git");
  });

  it.each(["branches", "worktrees", "stash", "conflicts"])(
    "rejects stale %s data across A → B → A",
    async (kind) => {
      const ws = useWorkspaceStore();
      await ws.openFolder("A");
      const old = deferred<unknown>();
      const store =
        kind === "branches"
          ? useBranchesStore()
          : kind === "worktrees"
            ? useWorktreesStore()
            : kind === "stash"
              ? useStashShelfStore()
              : useConflictsStore();
      const backend =
        kind === "branches"
          ? mocks.backend.refsList
          : kind === "worktrees"
            ? mocks.backend.worktreeList
            : kind === "stash"
              ? mocks.backend.stashList
              : mocks.backend.conflictsList;
      backend.mockReturnValueOnce(old.promise);
      const pending = store.refresh();
      await ws.openFolder("B");
      await ws.openFolder("A");
      old.resolve(
        kind === "branches"
          ? { current: "stale", local: [], remote: [], tags: [] }
          : kind === "conflicts"
            ? { entries: [{ path: "stale" }] }
            : [{ path: "stale" }],
      );
      await pending;
      expect(store.loading).toBe(false);
      if ("refs" in store) expect(store.refs).toBeNull();
      if ("items" in store) expect(store.items).toEqual([]);
      if ("stashes" in store) expect(store.stashes).toEqual([]);
      if ("list" in store) expect(store.list).toBeNull();
    },
  );

  it("discards an old merge editor so its result cannot be saved into another repo", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const conflicts = useConflictsStore();
    const old = deferred<unknown>();
    mocks.backend.conflictMerge3.mockReturnValueOnce(old.promise);
    const pending = conflicts.openMerge({ path: "same.txt" } as never);
    await ws.openFolder("B");
    old.resolve({ blocks: [], conflictCount: 0 });
    await pending;
    expect(conflicts.mergeTabs).toEqual([]);
    await conflicts.applyMergeResult("merge:same.txt");
    expect(mocks.backend.conflictSaveResult).not.toHaveBeenCalled();
  });

  it("keeps another repository's draft when a commit completes late", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const store = useCommitStore();
    store.message = "A draft";
    const old = deferred<unknown>();
    mocks.backend.commitCreate.mockReturnValueOnce(old.promise);
    const pending = store.commit();
    await ws.openFolder("B");
    store.message = "B draft";
    old.resolve({ sha: "abcd123", subject: "A draft", amended: false });
    await pending;
    expect(store.message).toBe("B draft");
    expect(localStorage.getItem("gitx.commitDraft.B")).toBe("B draft");
    expect(mocks.changes.refresh).not.toHaveBeenCalled();
  });

  it("does not enable amend or replace the draft after it was disabled", async () => {
    const ws = useWorkspaceStore();
    await ws.openFolder("A");
    const store = useCommitStore();
    store.message = "new draft";
    const old = deferred<string>();
    mocks.backend.commitHeadMessage.mockReturnValueOnce(old.promise);
    const pending = store.setAmend(true);
    await store.setAmend(false);
    old.resolve("old commit");
    await pending;
    expect(store.amend).toBe(false);
    expect(store.message).toBe("new draft");
  });
});
