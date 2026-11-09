<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { closeDialog, useDialogState } from "@/composables/useDialog";

defineProps<{ count: number }>();
const { t } = useI18n();
const dialogId = useDialogState().value?.id;
const message = ref(t("shelf.defaultMessage"));
const keepChanges = ref(false);
function submit() {
  closeDialog(
    { message: message.value.trim() || t("shelf.defaultMessage"), keepChanges: keepChanges.value },
    dialogId,
  );
}
</script>

<template>
  <div class="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
    <form
      class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shelf-create-title"
      @submit.prevent="submit"
    >
      <h2 id="shelf-create-title" class="mb-3 text-sm font-semibold">{{ t("shelf.create") }}</h2>
      <p class="mb-3 text-xs text-muted-foreground">{{ t("shelf.selectedCount", { count }) }}</p>
      <label class="block text-xs">
        {{ t("shelf.renamePrompt") }}
        <input
          v-model="message"
          autofocus
          class="mt-1 h-8 w-full rounded border bg-background px-2"
        />
      </label>
      <label class="mt-3 flex items-center gap-2 text-xs">
        <input v-model="keepChanges" type="checkbox" aria-describedby="shelf-keep-hint" />
        {{ t("shelf.keepChanges") }}
      </label>
      <p id="shelf-keep-hint" class="mt-1 text-xs text-muted-foreground">
        {{ t("shelf.keepChangesHint") }}
      </p>
      <div class="mt-4 flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" @click="closeDialog(null, dialogId)">{{
          t("common.cancel")
        }}</Button>
        <Button type="submit" size="sm">{{ t("common.ok") }}</Button>
      </div>
    </form>
  </div>
</template>
