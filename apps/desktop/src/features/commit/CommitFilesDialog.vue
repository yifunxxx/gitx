<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import PathChecklist, { type PathChecklistItem } from "@/components/common/PathChecklist.vue";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { useChangesStore, type ChangesSection } from "@/stores/changesStore";
import { fileStatusGlyph } from "./fileStatusGlyph";

const props = defineProps<{ initialPaths: string[]; section: ChangesSection }>();
const { t } = useI18n();
const dialogId = useDialogState().value?.id;
const changes = useChangesStore();
const source = useRepositoryAction(() => closeDialog(null, dialogId))();
const stagingMode = changes.stagingMode;
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
  closeDialog(null, dialogId);
}
function submit() {
  if (!source.current() || changes.stagingMode !== stagingMode) return;
  const available = new Set(candidateFiles.value.map((file) => file.path));
  const paths = selectedPaths.value.filter((path) => available.has(path));
  if (paths.length) closeDialog({ paths }, dialogId);
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
    >
      <h2 id="commit-files-title" class="text-sm font-semibold">{{ t("commitTw.commitFiles") }}</h2>
      <p class="text-xs text-muted-foreground">
        {{ t(stagingMode ? "commitTw.commitFilesStagingHint" : "commitTw.commitFilesHint") }}
      </p>
      <PathChecklist v-model="selectedPaths" :files="candidateFiles" />
      <div class="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" @click="cancel">{{
          t("common.cancel")
        }}</Button>
        <Button type="submit" size="sm" :disabled="!selectedPaths.length">{{
          t("common.ok")
        }}</Button>
      </div>
    </form>
  </div>
</template>
