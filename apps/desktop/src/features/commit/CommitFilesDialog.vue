<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import PathChecklist, { type PathChecklistItem } from "@/components/common/PathChecklist.vue";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { useChangesStore, type ChangesSection } from "@/stores/changesStore";
import { useCommitStore } from "@/stores/commitStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { formatErrorMessage } from "@/lib/errors";
import { fileStatusGlyph } from "./fileStatusGlyph";

const props = defineProps<{ initialPaths: string[]; section: ChangesSection }>();
const { t } = useI18n();
const dialogId = useDialogState().value?.id;
const changes = useChangesStore();
const commit = useCommitStore();
const rewrite = useRewriteStore();
const source = useRepositoryAction(() => closeDialog(null, dialogId))();
const stagingMode = changes.stagingMode;
const message = ref("");
const runHooks = ref(commit.runHooks);
const submitting = ref(false);
const error = ref("");
const busy = computed(() => submitting.value || commit.committing || rewrite.busy);
const initialPaths = [...new Set(props.initialPaths)];
const candidateFiles = computed<PathChecklistItem[]>(() => {
  const available = new Set(changes.pathsForSection(props.section));
  const metadata = new Map(changes.snapshot?.files.map((file) => [file.path, file]) ?? []);
  return initialPaths
    .filter((path) => available.has(path))
    .map((path) => {
      const file = metadata.get(path);
      return { path, origPath: file?.origPath, status: file ? fileStatusGlyph(file) : undefined };
    });
});
const selectedPaths = ref(candidateFiles.value.map((file) => file.path));
// Preserve what was reviewed when the window opened. A background refresh
// must not silently replace a partial selection's content/ownership token.
const initialSelection = stagingMode
  ? undefined
  : changes.commitSelection(initialPaths, props.section);
watch(candidateFiles, (files) => {
  const available = new Set(files.map((file) => file.path));
  selectedPaths.value = selectedPaths.value.filter((path) => available.has(path));
});
watch(
  () => changes.stagingMode,
  () => closeDialog(null, dialogId),
  { flush: "sync" },
);

function cancel() {
  if (!submitting.value) closeDialog(null, dialogId);
}
function onEscape(event: KeyboardEvent) {
  if (!submitting.value) return;
  event.preventDefault();
  event.stopPropagation();
}
function onEnter(event: KeyboardEvent) {
  // Searching or operating checkboxes must not implicitly create a commit.
  // Keep textarea newlines and the explicit buttons' normal keyboard actions.
  if (!event.isComposing && event.target instanceof HTMLInputElement) event.preventDefault();
}
async function submit() {
  if (
    busy.value ||
    !message.value.trim() ||
    !source.current() ||
    changes.stagingMode !== stagingMode
  )
    return;
  const available = new Set(candidateFiles.value.map((file) => file.path));
  const paths = selectedPaths.value.filter((path) => available.has(path));
  if (!paths.length) return;
  submitting.value = true;
  error.value = "";
  try {
    const selections = initialSelection?.filter((file) => paths.includes(file.path));
    const result = selections
      ? await commit.commitFiles(paths, message.value, runHooks.value, selections)
      : await commit.commitFiles(paths, message.value, runHooks.value);
    if (result && source.current()) closeDialog(result, dialogId);
  } catch (cause) {
    if (source.current()) error.value = formatErrorMessage(cause);
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
      aria-labelledby="commit-files-title"
      @submit.prevent="submit"
      @keydown.esc="onEscape"
      @keydown.enter="onEnter"
    >
      <h2 id="commit-files-title" class="text-sm font-semibold">{{ t("commitTw.commitFiles") }}</h2>
      <label class="block text-xs">
        {{ t("commit.messagePlaceholder") }}
        <textarea
          v-model="message"
          autofocus
          :disabled="busy"
          :aria-label="t('commit.messagePlaceholder')"
          class="mt-1 min-h-[64px] w-full resize-y rounded border bg-background px-2 py-1.5"
          spellcheck="false"
        />
      </label>
      <p class="text-xs text-muted-foreground">
        {{ t(stagingMode ? "commitTw.commitFilesStagingHint" : "commitTw.commitFilesHint") }}
      </p>
      <PathChecklist v-model="selectedPaths" :files="candidateFiles" :disabled="busy" />
      <label class="flex items-center gap-2 text-xs">
        <input
          v-model="runHooks"
          type="checkbox"
          :disabled="busy"
          :aria-label="t('commit.runHooks')"
        />
        {{ t("commit.runHooks") }}
      </label>
      <p v-if="error" role="alert" class="break-words text-xs text-destructive">{{ error }}</p>
      <p v-if="submitting" role="status" class="text-xs text-muted-foreground">
        {{ t("commitTw.committingFiles") }}
      </p>
      <div class="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" :disabled="submitting" @click="cancel">{{
          t("common.cancel")
        }}</Button>
        <Button
          type="submit"
          size="sm"
          :disabled="busy || !message.trim() || !selectedPaths.length"
          >{{ t("actions.commit") }}</Button
        >
      </div>
    </form>
  </div>
</template>
