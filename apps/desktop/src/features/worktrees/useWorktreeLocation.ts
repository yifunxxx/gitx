import { onScopeDispose, ref, watch, type Ref } from "vue";
import { getBackend } from "@/lib/backend";
import { formatErrorMessage } from "@/lib/errors";

/** Suggestions stop as soon as the user edits the destination. */
export function useWorktreeLocation(repoPath: string, branch: Readonly<Ref<string>>) {
  const location = ref("");
  const loading = ref(false);
  const error = ref<string | null>(null);
  let generation = 0;
  let edited = false;
  watch(
    branch,
    async (value) => {
      const request = ++generation;
      if (edited) return;
      loading.value = true;
      error.value = null;
      try {
        const result = await getBackend().worktreeDefaultPath({ repoPath, branch: value });
        if (request === generation) location.value = result.path;
      } catch (e) {
        if (request === generation) error.value = formatErrorMessage(e);
      } finally {
        if (request === generation) loading.value = false;
      }
    },
    { immediate: true },
  );
  function edit() {
    edited = true;
    ++generation;
    loading.value = false;
    error.value = null;
  }
  onScopeDispose(() => {
    ++generation;
  });
  return { location, loading, error, edit };
}
