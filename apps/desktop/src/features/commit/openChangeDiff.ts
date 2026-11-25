import { useChangesStore, type ChangesSection } from "@/stores/changesStore";
import { useDiffStore } from "@/stores/diffStore";

/** Changelists own the complete HEAD-to-worktree change, independent of staging. */
export function openChangeDiff(path: string, section: ChangesSection) {
  const changes = useChangesStore();
  const stagedChange = changes.staged.find((file) => file.path === path);
  const unstagedChange = changes.unstaged.find((file) => file.path === path);
  if (stagedChange?.kind === "unmerged" || unstagedChange?.kind === "unmerged") {
    // Conflicts have index stages 1/2/3, not the stage 0 used by normal Diff.
    // Show Diff stays read-only; conflict editing remains in the Merge editor.
    return useDiffStore().openFileDiff(path, "head", "worktree");
  }
  if (section.startsWith("changelist:") || (section === "unversioned" && !changes.stagingMode)) {
    const original = stagedChange?.origPath ?? unstagedChange?.origPath;
    return original
      ? useDiffStore().openFileDiff(path, "head", "worktree", { leftPath: original })
      : useDiffStore().openFileDiff(path, "head", "worktree");
  }
  if (section === "staged") {
    // Status origPath belongs to the HEAD side of a staged rename/copy.
    // The index and worktree already use the destination path.
    if (
      stagedChange?.origPath &&
      (stagedChange.indexStatus === "R" || stagedChange.indexStatus === "C")
    ) {
      return useDiffStore().openFileDiff(path, "head", "index", {
        leftPath: stagedChange.origPath,
      });
    }
    return useDiffStore().openFileDiff(path, "head", "index");
  }
  return useDiffStore().openFileDiff(path, "index", "worktree");
}
