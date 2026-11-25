<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import PathChecklist from "@/components/common/PathChecklist.vue";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useStashShelfStore } from "@/stores/stashShelfStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { formatErrorMessage } from "@/lib/errors";

const props = defineProps<{
  path: string;
  id: string;
  navigation: number;
  removeApplied: boolean;
}>();
const { t } = useI18n();
const store = useStashShelfStore();
const workspace = useWorkspaceStore();
const dialogId = useDialogState().value?.id;
const entry = computed(() => store.shelves.find((shelf) => shelf.id === props.id));
const files = computed(() => (entry.value?.paths ?? []).map((path) => ({ path })));
const selectedPaths = ref(files.value.map((file) => file.path));
const removeApplied = ref(props.removeApplied);
const submitting = ref(false);
const error = ref("");
const busy = computed(() => submitting.value || store.busy);
let alive = true;
const current = () =>
  alive &&
  workspace.isRepo &&
  workspace.repoPath === props.path &&
  workspace.navigationToken() === props.navigation;
onBeforeUnmount(() => {
  alive = false;
});
watch(
  () => [workspace.repoPath, workspace.navigationToken(), workspace.isRepo],
  () => {
    if (!current()) closeDialog(null, dialogId);
  },
  { flush: "sync", immediate: true },
);
watch(files, (next) => {
  const available = new Set(next.map((file) => file.path));
  selectedPaths.value = selectedPaths.value.filter((path) => available.has(path));
});
function cancel() {
  if (!submitting.value) closeDialog(null, dialogId);
}
function onEscape(event: KeyboardEvent) {
  if (submitting.value) {
    event.preventDefault();
    event.stopPropagation();
  }
}
function onEnter(event: KeyboardEvent) {
  if (!event.isComposing && event.target instanceof HTMLInputElement) event.preventDefault();
}
async function submit() {
  if (busy.value || !current()) return;
  const available = new Set(files.value.map((file) => file.path));
  const paths = selectedPaths.value.filter((path) => available.has(path));
  if (!paths.length) return;
  submitting.value = true;
  error.value = "";
  try {
    const outcome = await store.unshelveSelected(props.id, paths, removeApplied.value);
    if (!current()) return;
    if (outcome.ok) closeDialog(true, dialogId);
    else {
      // A partial apply can write successfully even when the saved record is
      // kept. Remove those paths from retry selection to avoid applying twice.
      const applied = new Set(outcome.result?.applied ?? []);
      selectedPaths.value = selectedPaths.value.filter((path) => !applied.has(path));
      error.value = store.error ?? t("shelf.applySelectionFailed");
    }
  } catch (cause) {
    if (current()) error.value = formatErrorMessage(cause);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
    <form
      class="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-auto rounded-lg border bg-popover p-4 shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unshelve-title"
      @submit.prevent="submit"
      @keydown.esc="onEscape"
      @keydown.enter="onEnter"
    >
      <h2 id="unshelve-title" class="truncate text-sm font-semibold" :title="entry?.message">
        {{ t("shelf.unshelve") }} · {{ entry?.message }}
      </h2>
      <p class="text-xs text-muted-foreground">{{ t("shelf.selectRestoreFiles") }}</p>
      <PathChecklist v-model="selectedPaths" :files="files" :disabled="busy" />
      <label class="flex items-center gap-2 text-xs">
        <input v-model="removeApplied" type="checkbox" :disabled="busy" />{{
          t("shelf.removeApplied")
        }}
      </label>
      <p class="text-xs text-muted-foreground">{{ t("shelf.selectionHint") }}</p>
      <p v-if="!entry" role="alert" class="text-xs text-destructive">
        {{ t("shelf.selectionUnavailable") }}
      </p>
      <p v-if="error" role="alert" class="break-words text-xs text-destructive">{{ error }}</p>
      <p v-if="submitting" role="status" class="text-xs text-muted-foreground">
        {{ t("shelf.restoringFiles") }}
      </p>
      <div class="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" :disabled="submitting" @click="cancel">{{
          t("common.cancel")
        }}</Button>
        <Button
          type="submit"
          size="sm"
          :disabled="busy || !selectedPaths.length"
          data-unshelve-submit
          >{{ t("shelf.unshelve") }}</Button
        >
      </div>
    </form>
  </div>
</template>
