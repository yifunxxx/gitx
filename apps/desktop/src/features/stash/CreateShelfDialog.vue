<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import PathChecklist, { type PathChecklistItem } from "@/components/common/PathChecklist.vue";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useChangesStore } from "@/stores/changesStore";
import { fileStatusGlyph } from "@/features/commit/fileStatusGlyph";

const props = defineProps<{ initialPaths?: string[] }>();
const { t } = useI18n();
const dialogId = useDialogState().value?.id;
const changes = useChangesStore();
const message = ref(t("shelf.defaultMessage"));
const keepChanges = ref(false);
const selectedPaths = ref<string[]>([]);
const initial = new Set(props.initialPaths ?? []);
const hadInitial = initial.size > 0;

const candidateFiles = computed(() => {
  const seen = new Set<string>();
  const out: PathChecklistItem[] = [];
  for (const file of changes.changed) {
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

function submit() {
  if (!selectedPaths.value.length) return;
  closeDialog(
    {
      message: message.value.trim() || t("shelf.defaultMessage"),
      keepChanges: keepChanges.value,
      paths: [...selectedPaths.value],
    },
    dialogId,
  );
}
</script>

<template>
  <div class="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
    <form
      class="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-auto rounded-lg border bg-popover p-4 shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shelf-create-title"
      @submit.prevent="submit"
    >
      <h2 id="shelf-create-title" class="text-sm font-semibold">{{ t("shelf.create") }}</h2>
      <p class="text-xs text-muted-foreground">{{ t("shelf.selectFiles") }}</p>
      <PathChecklist v-model="selectedPaths" :files="candidateFiles" />
      <label class="block text-xs">
        {{ t("shelf.renamePrompt") }}
        <input
          v-model="message"
          autofocus
          class="mt-1 h-8 w-full rounded border bg-background px-2"
        />
      </label>
      <label class="flex items-center gap-2 text-xs">
        <input v-model="keepChanges" type="checkbox" aria-describedby="shelf-keep-hint" />
        {{ t("shelf.keepChanges") }}
      </label>
      <p id="shelf-keep-hint" class="text-xs text-muted-foreground">
        {{ t("shelf.keepChangesHint") }}
      </p>
      <div class="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" @click="closeDialog(null, dialogId)">{{
          t("common.cancel")
        }}</Button>
        <Button type="submit" size="sm" :disabled="!selectedPaths.length">{{
          t("common.ok")
        }}</Button>
      </div>
    </form>
  </div>
</template>
