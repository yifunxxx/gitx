import type { FileChange } from "@/lib/backend";

/** Single-letter status for path checklists (index wins over worktree). */
export function fileStatusGlyph(file: FileChange): string {
  if (file.kind === "untracked" || file.indexStatus === "?") return "?";
  if (file.kind === "ignored" || file.indexStatus === "!") return "!";
  if (file.indexStatus && file.indexStatus !== ".") return file.indexStatus;
  if (file.worktreeStatus && file.worktreeStatus !== ".") return file.worktreeStatus;
  return "·";
}
