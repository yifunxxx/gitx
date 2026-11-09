<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";

const props = defineProps<{ includeUntracked?: boolean }>();
const { t } = useI18n();
const message = ref("WIP");
const includeUntracked = ref(props.includeUntracked ?? false);
const keepIndex = ref(false);
function submit() {
  closeDialog({
    message: message.value.trim() || "WIP",
    includeUntracked: includeUntracked.value,
    keepIndex: keepIndex.value,
  });
}
</script>

<template>
  <div class="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
    <form
      class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stash-create-title"
      @submit.prevent="submit"
    >
      <h2 id="stash-create-title" class="mb-3 text-sm font-semibold">{{ t("stash.create") }}</h2>
      <label class="block text-xs">
        {{ t("stash.messagePrompt") }}
        <input
          v-model="message"
          autofocus
          class="mt-1 h-8 w-full rounded border bg-background px-2"
        />
      </label>
      <label class="mt-3 flex items-center gap-2 text-xs"
        ><input v-model="includeUntracked" type="checkbox" />{{
          t("stash.includeUntracked")
        }}</label
      >
      <label class="mt-2 flex items-center gap-2 text-xs"
        ><input v-model="keepIndex" type="checkbox" />{{ t("stash.keepIndex") }}</label
      >
      <div class="mt-4 flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" @click="closeDialog(null)">{{
          t("common.cancel")
        }}</Button>
        <Button type="submit" size="sm">{{ t("common.ok") }}</Button>
      </div>
    </form>
  </div>
</template>
