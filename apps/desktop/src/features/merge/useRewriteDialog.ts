import { computed, ref } from "vue";
import { closeDialog, useDialogStack, useDialogState } from "@/composables/useDialog";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { useRewriteStore } from "@/stores/rewriteStore";
import { formatErrorMessage } from "@/lib/errors";

/** Bind a pending edit to its original repository and dialog. */
export function useRewriteDialog() {
  const rewrite = useRewriteStore();
  const dialog = useDialogState();
  const stack = useDialogStack();
  const dialogId = dialog.value?.id;
  const capture = useRepositoryAction(() => closeDialog(false, dialogId));
  const source = capture();
  const working = ref(false);
  const busy = computed(() => working.value || rewrite.busy);
  const error = ref<string | null>(null);
  const current = () => source.current() && dialog.value?.id === dialogId;
  function dismiss() {
    if (current() && !busy.value) closeDialog(false, dialogId);
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
      // A completed rewrite may open a child conflict dialog. Close only our
      // own entry, leaving that child open; a replaced/unmounted edit is inert.
      if (result && source.current() && stack.value.some((item) => item.id === dialogId))
        closeDialog(true, dialogId);
    } catch (reason) {
      showError(reason);
    } finally {
      working.value = false;
    }
  }
  return { path: source.path, busy, error, current, dismiss, showError, submit };
}
