import type { FileChangeKind } from "@/lib/backend";

export function statusClass(kind: FileChangeKind): string {
  switch (kind) {
    case "modified":
      return "text-[rgb(var(--vcs-modified))]";
    case "added":
      return "text-[rgb(var(--vcs-added))]";
    case "deleted":
      return "text-[rgb(var(--vcs-deleted))] line-through";
    case "renamed":
    case "copied":
      return "text-[rgb(var(--vcs-renamed))]";
    case "untracked":
      return "text-[rgb(var(--vcs-unversioned))]";
    case "ignored":
      return "text-[rgb(var(--vcs-ignored))]";
    case "unmerged":
      return "text-[rgb(var(--vcs-conflict))]";
    default:
      return "text-foreground";
  }
}
