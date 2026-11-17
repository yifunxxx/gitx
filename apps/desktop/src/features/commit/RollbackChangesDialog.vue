<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import PathChecklist, { type PathChecklistItem } from "@/components/common/PathChecklist.vue";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useChangesStore } from "@/stores/changesStore";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { fileStatusGlyph } from "@/features/commit/fileStatusGlyph";

const props = defineProps<{ initialPaths?: string[] }>();
const { t } = useI18n();
const dialogId = useDialogState().value?.id;
const changes = useChangesStore();
const captureRepository = useRepositoryAction(() => closeDialog(null, dialogId));
const source = captureRepository();
const selectedPaths = ref<string[]>([]);
const initial = new Set(props.initialPaths ?? []);
const hadInitial = initial.size > 0;

const candidateFiles = computed(() => {
  const seen = new Set<string>();
  const out: PathChecklistItem[] = [];
  for (const file of [...changes.staged, ...changes.unstaged]) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    out.push({
      path: file.path,
      origPath: file.origPath,
      status: fileStatusGlyph(file),
    });
  }
  return out;
});

function defaultSelection(files: PathChecklistItem[]): string[] {
  if (!files.length) return [];
  if (hadInitial) {
    const picked = files.filter((file) => initial.has(file.path)).map((file) => file.path);
    return picked.length ? picked : files.map((file) => file.path);
  }
  return files.map((file) => file.path);
}

selectedPaths.value = defaultSelection(candidateFiles.value);

watch(
  candidateFiles,
  (files) => {
    if (!selectedPaths.value.length && files.length) {
      selectedPaths.value = defaultSelection(files);
    }
  },
  { flush: "post" },
);

function cancel() {
  closeDialog(null, dialogId);
}
function submit() {
  if (!selectedPaths.value.length || !source.current()) return;
  closeDialog({ paths: [...selectedPaths.value] }, dialogId);
}
</script>

<template>
  <div
    class="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
    @keydown.esc.stop.prevent="cancel"
  >
    <form
      class="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-auto rounded-lg border bg-popover p-4 shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rollback-title"
      @submit.prevent="submit"
    >
      <h2 id="rollback-title" class="text-sm font-semibold">{{ t("commitTw.rollbackTitle") }}</h2>
      <p class="text-xs text-muted-foreground">{{ t("commitTw.rollbackHint") }}</p>
      <PathChecklist v-model="selectedPaths" :files="candidateFiles" />
      <div class="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" @click="cancel">{{
          t("common.cancel")
        }}</Button>
        <Button type="submit" size="sm" variant="destructive" :disabled="!selectedPaths.length">{{
          t("commitTw.rollback")
        }}</Button>
      </div>
    </form>
  </div>
</template>
