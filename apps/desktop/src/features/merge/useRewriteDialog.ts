import { computed, onUnmounted, ref, watch } from "vue";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { formatErrorMessage } from "@/lib/errors";

/** Bind a pending edit to the repository and dialog where it was started. */
export function useRewriteDialog() {
  const workspace = useWorkspaceStore();
  const rewrite = useRewriteStore();
  const dialog = useDialogState();
  const dialogId = dialog.value?.id;
  const path = workspace.repoPath;
  const navigation = workspace.navigationToken();
  const working = ref(false);
  const busy = computed(() => working.value || rewrite.busy);
  const error = ref<string | null>(null);
  let invalidated = false;
  const current = () =>
    !invalidated &&
    !!path &&
    workspace.repoPath === path &&
    workspace.navigationToken() === navigation &&
    dialog.value?.id === dialogId;
  watch(
    () => workspace.repoPath,
    () => {
      invalidated = true;
      closeDialog(false, dialogId);
    },
    { flush: "sync" },
  );
  onUnmounted(() => {
    invalidated = true;
  });
  function dismiss() {
    // A navigation attempt can invalidate submission before repoPath changes.
    // The user must still be able to dismiss that now-stale dialog.
    if (dialog.value?.id === dialogId && !busy.value) closeDialog(false, dialogId);
  }
  function showError(reason: unknown) {
    if (current()) error.value = formatErrorMessage(reason);
  }
  async function submit(operation: () => Promise<unknown>) {
    if (!current() || busy.value) return;
    working.value = true;
    error.value = null;
    try {
      const result = await operation();
      if (result && current()) closeDialog(true, dialogId);
    } catch (reason) {
      showError(reason);
    } finally {
      working.value = false;
    }
  }
  return { path, busy, error, current, dismiss, showError, submit };
}
