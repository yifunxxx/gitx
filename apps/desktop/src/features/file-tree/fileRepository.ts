import type { RepoRoot } from "@/lib/backend";
import { relativeToRoot } from "@/lib/projectFilePath";
import { workspacePathKey } from "@/lib/workspacePath";

export function owningRepository(folder: string, path: string, roots: RepoRoot[]) {
  const full = workspacePathKey(`${folder}/${path}`);
  return roots
    .filter(
      (root) =>
        full === workspacePathKey(root.worktreeRoot) ||
        relativeToRoot(folder, path, root.worktreeRoot) !== null,
    )
    .sort((a, b) => b.worktreeRoot.length - a.worktreeRoot.length)[0];
}
