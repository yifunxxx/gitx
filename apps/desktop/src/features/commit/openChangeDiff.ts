import { useChangesStore, type ChangesSection } from "@/stores/changesStore";
import { useDiffStore } from "@/stores/diffStore";

/** Use the layer with actual changes when a changelist combines both layers. */
export function openChangeDiff(path: string, section: ChangesSection) {
  const changes = useChangesStore();
  const stagedChange = changes.staged.find((file) => file.path === path);
  const stagedOnly =
    section.startsWith("changelist:") &&
    !!stagedChange &&
    !changes.unstaged.some((file) => file.path === path);
  if (section === "staged" || stagedOnly) {
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
