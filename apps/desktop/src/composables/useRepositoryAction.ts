import { onScopeDispose, watch } from "vue";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/** Capture the source before a menu action awaits a dialog or backend call. */
export function useRepositoryAction(invalidate?: () => void) {
  const workspace = useWorkspaceStore();
  let generation = 0;
  let disposed = false;
  watch(
    () => [workspace.repoPath, workspace.repoId, workspace.isRepo, workspace.navigationToken()],
    () => {
      ++generation;
      invalidate?.();
    },
    { flush: "sync" },
  );
  onScopeDispose(() => {
    disposed = true;
  });
  return () => {
    const path = workspace.repoPath;
    const repoId = workspace.repoId;
    const navigation = workspace.navigationToken();
    const captured = generation;
    return {
      path,
      repoId,
      current: () =>
        !disposed &&
        captured === generation &&
        !!path &&
        workspace.isRepo &&
        workspace.repoPath === path &&
        workspace.repoId === repoId &&
        workspace.navigationToken() === navigation,
    };
  };
}
