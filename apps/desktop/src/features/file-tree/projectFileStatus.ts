import type { FileChange } from "@/lib/backend";
import type { ChangesSection } from "@/stores/changesStore";
import { relativeToRoot } from "@/lib/projectFilePath";

/** One linear pass over status; deleted descendants decorate existing parents. */
export function aggregateFolderChanges(files: FileChange[], repoRoot: string, folder: string) {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (file.kind === "ignored") continue;
    const parents = new Set<string>();
    for (const path of new Set([file.path, ...(file.origPath ? [file.origPath] : [])])) {
      let relative = relativeToRoot(repoRoot, path, folder);
      if (relative === null) continue;
      while (relative.includes("/")) {
        relative = relative.slice(0, relative.lastIndexOf("/"));
        parents.add(relative);
      }
    }
    for (const parent of parents) counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  return counts;
}

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
