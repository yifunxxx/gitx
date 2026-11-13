<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import PathChecklist, { type PathChecklistItem } from "@/components/common/PathChecklist.vue";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useChangesStore } from "@/stores/changesStore";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { fileStatusGlyph } from "@/features/commit/fileStatusGlyph";

const props = defineProps<{ initialPaths?: string[]; sourceListId?: string | null }>();
const { t } = useI18n();
const dialogId = useDialogState().value?.id;
const changes = useChangesStore();
const captureRepository = useRepositoryAction(() => closeDialog(null, dialogId));
const source = captureRepository();
const selectedPaths = ref<string[]>([]);
const initial = new Set(props.initialPaths ?? []);
const hadInitial = initial.size > 0;
const lists = computed(() => changes.changelists?.lists ?? []);
const targetMode = ref<"existing" | "new">("existing");
const targetListId = ref(
  lists.value.find((list) => list.id !== props.sourceListId)?.id ??
    lists.value.find((list) => list.id === "default")?.id ??
    lists.value[0]?.id ??
    "default",
);
const newName = ref("");

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
    return picked.length ? picked : [];
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

watch(
  lists,
  (next) => {
    if (targetMode.value !== "existing") return;
    if (next.some((list) => list.id === targetListId.value)) return;
    targetListId.value =
      next.find((list) => list.id !== props.sourceListId)?.id ?? next[0]?.id ?? "default";
  },
  { flush: "post" },
);

const canSubmit = computed(() => {
  if (!selectedPaths.value.length || !source.current()) return false;
  if (targetMode.value === "new") return !!newName.value.trim();
  return !!targetListId.value;
});

function cancel() {
  closeDialog(null, dialogId);
}

function submit() {
  if (!canSubmit.value) return;
  if (targetMode.value === "new") {
    closeDialog(
      {
        paths: [...selectedPaths.value],
        newName: newName.value.trim(),
        targetListId: null,
      },
      dialogId,
    );
    return;
  }
  closeDialog(
    {
      paths: [...selectedPaths.value],
      newName: null,
      targetListId: targetListId.value,
    },
    dialogId,
  );
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
      aria-labelledby="move-changelist-title"
      @submit.prevent="submit"
    >
      <h2 id="move-changelist-title" class="text-sm font-semibold">
        {{ t("commitTw.moveToChangelistTitle") }}
      </h2>
      <p class="text-xs text-muted-foreground">{{ t("commitTw.moveToChangelistHint") }}</p>
      <PathChecklist v-model="selectedPaths" :files="candidateFiles" />
      <fieldset class="space-y-2 rounded border p-2">
        <legend class="px-1 text-xs font-medium">{{ t("commitTw.moveToChangelistTarget") }}</legend>
        <label class="flex items-start gap-2 text-xs">
          <input v-model="targetMode" class="mt-0.5" type="radio" value="existing" />
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            {{ t("commitTw.moveToExistingChangelist") }}
            <select
              v-model="targetListId"
              class="h-8 w-full rounded border bg-background px-2"
              :disabled="targetMode !== 'existing'"
            >
              <option v-for="list in lists" :key="list.id" :value="list.id">
                {{ list.name }}{{ list.id === "default" ? ` (${t("changelist.default")})` : ""
                }}{{ list.active ? ` — ${t("changelist.active")}` : "" }}
              </option>
            </select>
          </span>
        </label>
        <label class="flex items-start gap-2 text-xs">
          <input v-model="targetMode" class="mt-0.5" type="radio" value="new" />
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            {{ t("commitTw.moveToNewChangelist") }}
            <input
              v-model="newName"
              class="h-8 w-full rounded border bg-background px-2"
              :placeholder="t('changelist.namePlaceholder')"
              :disabled="targetMode !== 'new'"
              @focus="targetMode = 'new'"
            />
          </span>
        </label>
      </fieldset>
      <div class="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" @click="cancel">{{
          t("common.cancel")
        }}</Button>
        <Button type="submit" size="sm" :disabled="!canSubmit">{{ t("common.ok") }}</Button>
      </div>
    </form>
  </div>
</template>
