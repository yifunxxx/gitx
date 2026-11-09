import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useRewriteStore } from "@/stores/rewriteStore";

/** Capture before awaiting a prompt or lazy import; never retarget a write. */
export function captureRewriteContext() {
  const workspace = useWorkspaceStore();
  const rewrite = useRewriteStore();
  const path = workspace.repoPath;
  const navigation = workspace.navigationToken();
  const repository = rewrite.repositoryToken();
  return () =>
    !!path &&
    workspace.repoPath === path &&
    workspace.isRepo &&
    workspace.navigationToken() === navigation &&
    rewrite.repositoryToken() === repository;
}
