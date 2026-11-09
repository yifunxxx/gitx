<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const props = defineProps<{
  files: string[];
  operation: string;
}>();

const { t } = useI18n();
const dialogId = useDialogState().value?.id;
const workspace = useWorkspaceStore();
const titleOp = computed(() =>
  t(`merge.operationNames.${props.operation === "cherry-pick" ? "cherryPick" : props.operation}`),
);
const close = (choice: "smart" | "cancel") => closeDialog(choice, dialogId);
watch(
  () => workspace.repoPath,
  () => close("cancel"),
  { flush: "sync" },
);
</script>

<template>
  <div class="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
    <div
      class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dirty-worktree-title"
    >
      <h2 id="dirty-worktree-title" class="text-sm font-semibold">
        {{ t("merge.dirtyTitle", { operation: titleOp }) }}
      </h2>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ t("merge.smartDescription") }}
      </p>
      <ul class="mt-3 max-h-48 overflow-auto rounded border text-xs">
        <li v-for="f in files" :key="f" class="border-b px-2 py-1 font-mono last:border-b-0">
          {{ f }}
        </li>
        <li v-if="!files.length" class="px-2 py-2 text-muted-foreground">
          {{ t("merge.dirtyFilesUnavailable") }}
        </li>
      </ul>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" @click="close('cancel')">{{ t("common.cancel") }}</Button>
        <Button size="sm" @click="close('smart')">{{
          t("merge.smartAction", { operation: titleOp })
        }}</Button>
      </div>
    </div>
  </div>
</template>
