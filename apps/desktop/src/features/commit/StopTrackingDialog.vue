<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useRepositoryAction } from "@/composables/useRepositoryAction";

defineProps<{ count: number }>();
const { t } = useI18n();
const dialogId = useDialogState().value?.id;
const addToGitignore = ref(false);
const captureRepository = useRepositoryAction(() => closeDialog(null, dialogId));
const source = captureRepository();
function cancel() {
  closeDialog(null, dialogId);
}
function submit() {
  if (source.current()) closeDialog({ addToGitignore: addToGitignore.value }, dialogId);
}
</script>

<template>
  <div
    class="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
    @keydown.esc.stop.prevent="cancel"
  >
    <form
      class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stop-tracking-title"
      @submit.prevent="submit"
    >
      <h2 id="stop-tracking-title" class="text-sm font-semibold">
        {{ t("commitTw.untrackTitle") }}
      </h2>
      <p class="mt-2 text-xs text-muted-foreground">
        {{ t("commitTw.untrackConfirm", { count }) }}
      </p>
      <label class="mt-3 flex items-center gap-2 text-xs">
        <input v-model="addToGitignore" type="checkbox" />
        {{ t("commitTw.untrackAlsoIgnore") }}
      </label>
      <div class="mt-4 flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" @click="cancel">{{
          t("common.cancel")
        }}</Button>
        <Button type="submit" size="sm" variant="destructive">{{ t("commitTw.untrack") }}</Button>
      </div>
    </form>
  </div>
</template>
