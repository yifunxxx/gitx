import type { FileChange } from "@/lib/backend";
import type { ChangesSection } from "@/stores/changesStore";

export function projectFileDiffSection(change: FileChange | undefined): ChangesSection | null {
  if (!change || change.kind === "ignored") return null;
  if (change.kind === "untracked") return "unversioned";
  if (change.kind === "unmerged" || ![".", " ", ""].includes(change.worktreeStatus))
    return "unstaged";
  return ![".", " ", ""].includes(change.indexStatus) ? "staged" : null;
}

export function projectFileStatusLabel(change: FileChange): string {
  if (change.kind === "unmerged") return "U";
  if (change.kind === "untracked") return "?";
  if (change.kind === "ignored") return "!";
  return [change.indexStatus, change.worktreeStatus]
    .filter((status) => ![".", " ", ""].includes(status))
    .filter((status, index, all) => all.indexOf(status) === index)
    .join("");
}
