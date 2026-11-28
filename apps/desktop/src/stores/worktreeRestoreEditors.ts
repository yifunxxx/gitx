import { useFileViewerStore } from "./fileViewerStore";
import { useConflictsStore } from "./conflictsStore";
import { workspacePathKey } from "@/lib/workspacePath";
import { i18n } from "@/i18n";

/** Acquire after confirmation, immediately before any index/worktree write. */
export function beginWorktreeRestore(root: string, paths: string[]) {
  const files = useFileViewerStore();
  const conflicts = useConflictsStore();
  const affected = files.affectedByFiles(root, paths);
  if (
    files.fileMutationPending ||
    conflicts.busy ||
    affected.some((tab) => tab.loading || tab.saving || tab.fileOperationPending)
  )
    throw new Error(i18n.global.t("history.restoreBusy"));
  const contains = (path: string) => {
    const key = workspacePathKey(`${root}/${path}`);
    return paths.some((parent) => {
      const parentKey = workspacePathKey(`${root}/${parent}`);
      return key === parentKey || key.startsWith(`${parentKey}/`);
    });
  };
  if (conflicts.mergeTabs.some((tab) => contains(tab.path)))
    throw new Error(i18n.global.t("history.restoreMergeOpen"));
  if (affected.some((tab) => tab.dirty)) throw new Error(i18n.global.t("history.restoreDrafts"));

  const editors = new Set(affected);
  files.fileMutationPending = true;
  for (const tab of affected) {
    tab.fileOperationPending = true;
    tab.restorePending = true;
  }
  let released = false;
  return {
    restored(path: string) {
      if (released) return;
      // Successful disk writes invalidate only their original clean buffers.
      // Closed/reopened or newly navigated tabs must never be closed by an old write.
      for (const tab of files.affectedByFiles(root, [path])) {
        if (editors.has(tab)) files.closeTab(tab.id);
      }
    },
    release() {
      if (released) return;
      released = true;
      for (const tab of editors) {
        tab.fileOperationPending = false;
        tab.restorePending = false;
      }
      files.fileMutationPending = false;
    },
  };
}
