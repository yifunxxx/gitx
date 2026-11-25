import { getActivePinia, type Pinia } from "pinia";
import type { Backend } from "./index";

// Only explicit user operations belong here. Background reads and polling must
// remain silent; fetch/pull/push/checkout and native jobs own their full lifecycle.
export const operationTitles = {
  workspaceOpen: "open", initRun: "init", vcsEnable: "init",
  branchCreate: "branchCreate", branchRename: "branchRename",
  branchDelete: "branchDelete", branchRestore: "branchRestore", branchUpdate: "branchUpdate",
  tagCreate: "tagCreate", tagDelete: "tagDelete", tagPush: "tagPush",
  compareBranches: "compareBranches",
  remoteAdd: "remoteEdit", remoteEdit: "remoteEdit", remoteRemove: "remoteEdit",
  remoteDeleteBranch: "branchDelete", unshallowRun: "unshallow",
  stagePaths: "stage", addPaths: "stage", stageHunks: "stage", stageLines: "stage",
  unstagePaths: "unstage", unstageHunks: "unstage", unstageLines: "unstage",
  commitCreate: "commit", fileWriteWorktree: "save", checkoutPathFromRev: "restore",
  mergeRun: "merge", mergeAbort: "merge", mergeCommit: "merge",
  rebaseRun: "rebase", rebaseContinue: "rebase", rebaseSkip: "rebase", rebaseAbort: "rebase",
  rebaseInteractiveStart: "rebase", cherryPickRun: "cherryPick",
  cherryPickContinue: "cherryPick", cherryPickSkip: "cherryPick", cherryPickAbort: "cherryPick",
  smartRestoreChanges: "restore", conflictAcceptSide: "conflict", conflictSaveResult: "conflict",
  conflictMarkResolved: "conflict", conflictResolveSimple: "conflict",
  rewordCommit: "rewrite", squashCommits: "rewrite", dropCommits: "rewrite", fixupInto: "rewrite",
  uncommit: "rewrite", revertRun: "restore", revertContinue: "restore", revertAbort: "restore",
  resetRun: "reset", undoRewrite: "rewrite", extractChanges: "rewrite", dropChanges: "restore",
  revertLines: "restore", revertHunks: "restore", changelistCreate: "changelist", changelistRename: "changelist",
  changelistDelete: "changelist", changelistSetActive: "changelist", changelistMove: "changelist",
  stashCreate: "stashCreate", stashApply: "stashApply", stashPop: "stashApply",
  stashDrop: "stashDelete", stashClear: "stashDelete", stashBranch: "stashApply", stashRestore: "stashApply",
  shelfCreate: "shelfCreate", shelfUnshelve: "shelfApply", shelfDelete: "shelfEdit",
  shelfRestore: "shelfEdit", shelfRename: "shelfEdit", shelfImport: "shelfEdit", shelfExport: "shelfEdit",
  ignoreAdd: "ignore", rmCached: "untrack", patchCreate: "patch", patchApply: "patch",
  patchApplyClipboard: "patch", worktreeAdd: "worktree", worktreeRemove: "worktree",
  worktreeLock: "worktree", worktreeUnlock: "worktree", worktreePrune: "worktree",
  worktreeOpenRef: "worktree", syncFork: "syncFork", submoduleUpdate: "submodule",
  logIndexRebuild: "index",
} satisfies Partial<Record<keyof Backend, string>>;

export type OperationNotice = { titleKey: string; target?: string; path?: string };
type Observer = (operation: OperationNotice) => () => void;
const observers = new WeakMap<Pinia, Observer>();

export function observeBackendActivity(pinia: Pinia, observer: Observer) {
  observers.set(pinia, observer);
  return () => { if (observers.get(pinia) === observer) observers.delete(pinia); };
}

export function withBackendActivity<T extends object>(backend: T): T {
  const wrappers = new Map<PropertyKey, unknown>();
  return new Proxy(backend, {
    get(target, key, receiver) {
      if (!Object.hasOwn(operationTitles, key)) return Reflect.get(target, key, receiver);
      if (!wrappers.has(key)) wrappers.set(key, async (...args: unknown[]) => {
        const pinia = getActivePinia();
        const observer = pinia && observers.get(pinia);
        const req = args[0] as Record<string, unknown> | undefined;
        const detail = [req?.name, req?.target, req?.local, req?.ref].find((v) => typeof v === "string");
        const finish = observer?.({
          titleKey: `operations.${operationTitles[key as keyof typeof operationTitles]}`,
          target: typeof detail === "string" ? detail : undefined,
          path: typeof req?.path === "string" ? req.path : undefined,
        });
        try {
          const method = Reflect.get(target, key);
          if (typeof method !== "function") throw new TypeError(`Backend operation ${String(key)} is not callable`);
          return await Reflect.apply(method, target, args);
        } finally {
          // Completion is not a success claim: structured failures are handled
          // by the caller exactly as before. Never offer cancellation for these.
          finish?.();
        }
      });
      return wrappers.get(key);
    },
  });
}
