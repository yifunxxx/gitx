import { useChangesStore, type ChangesSection } from "@/stores/changesStore";
import { useDiffStore } from "@/stores/diffStore";

/** Use the layer with actual changes when a changelist combines both layers. */
export function openChangeDiff(path: string, section: ChangesSection) {
  const changes = useChangesStore();
  const stagedOnly =
    section.startsWith("changelist:") &&
    changes.staged.some((file) => file.path === path) &&
    !changes.unstaged.some((file) => file.path === path);
  return section === "staged" || stagedOnly
    ? useDiffStore().openFileDiff(path, "head", "index")
    : useDiffStore().openFileDiff(path, "index", "worktree");
}
