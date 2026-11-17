<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import PathChecklist, { type PathChecklistItem } from "@/components/common/PathChecklist.vue";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useChangesStore } from "@/stores/changesStore";
import { fileStatusGlyph } from "@/features/commit/fileStatusGlyph";

const props = defineProps<{ includeUntracked?: boolean; initialPaths?: string[] }>();
const { t } = useI18n();
const dialogId = useDialogState().value?.id;
const changes = useChangesStore();
const message = ref("WIP");
const includeUntracked = ref(props.includeUntracked ?? false);
const keepIndex = ref(false);
const selectedPaths = ref<string[]>([]);
const initial = new Set(props.initialPaths ?? []);
const hadInitial = initial.size > 0;

const candidateFiles = computed(() => {
  const files = [...changes.staged, ...changes.unstaged];
  if (includeUntracked.value) files.push(...changes.unversioned);
  const seen = new Set<string>();
  const out: PathChecklistItem[] = [];
  for (const file of files) {
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

watch(includeUntracked, (enabled, wasEnabled) => {
  if (enabled === wasEnabled) return;
  const available = new Set(candidateFiles.value.map((file) => file.path));
  if (!enabled) {
    selectedPaths.value = selectedPaths.value.filter((path) => available.has(path));
    return;
  }
  const next = new Set(selectedPaths.value.filter((path) => available.has(path)));
  for (const file of candidateFiles.value) {
    if (!changes.unversioned.some((entry) => entry.path === file.path)) continue;
    if (!hadInitial || initial.has(file.path)) next.add(file.path);
  }
  selectedPaths.value = [...next];
});

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
      message: message.value.trim() || "WIP",
      includeUntracked: includeUntracked.value,
      keepIndex: keepIndex.value,
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
      aria-labelledby="stash-create-title"
      @submit.prevent="submit"
    >
      <h2 id="stash-create-title" class="text-sm font-semibold">{{ t("stash.create") }}</h2>
      <label class="block text-xs">
        {{ t("stash.messagePrompt") }}
        <input
          v-model="message"
          autofocus
          class="mt-1 h-8 w-full rounded border bg-background px-2"
        />
      </label>
      <p class="text-xs text-muted-foreground">{{ t("stash.selectFilesHint") }}</p>
      <PathChecklist v-model="selectedPaths" :files="candidateFiles" />
      <label class="flex items-center gap-2 text-xs"
        ><input v-model="includeUntracked" type="checkbox" />{{
          t("stash.includeUntracked")
        }}</label
      >
      <label class="flex items-center gap-2 text-xs"
        ><input v-model="keepIndex" type="checkbox" />{{ t("stash.keepIndex") }}</label
      >
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
