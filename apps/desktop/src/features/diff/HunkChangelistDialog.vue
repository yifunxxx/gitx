<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import type { ChangelistInfo } from "@/lib/backend";
const props = defineProps<{
  lists: ChangelistInfo[];
  block: number;
  path: string;
  problem?: string;
}>();
const { t } = useI18n();
const id = useDialogState().value?.id;
const source = useRepositoryAction(() => closeDialog(null, id))();
function choose(value: string | null) {
  if (source.current()) closeDialog(value, id);
}
</script>
<template>
  <div
    class="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
    @keydown.esc.stop.prevent="choose(null)"
  >
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="hunk-list-title"
      class="flex max-h-[80vh] w-full max-w-sm flex-col gap-3 rounded-lg border bg-popover p-4 shadow-lg"
    >
      <h2 id="hunk-list-title" class="text-sm font-semibold">
        {{ t("changelist.moveBlock", { block: props.block }) }}
      </h2>
      <p class="truncate text-xs text-muted-foreground">{{ props.path }}</p>
      <p v-if="props.problem" role="status" class="text-xs text-amber-600 dark:text-amber-400">
        {{ t("changelist.reassignHint") }}
      </p>
      <div class="flex min-h-0 flex-col gap-1 overflow-y-auto">
        <Button
          v-for="list in props.lists"
          :key="list.id"
          variant="ghost"
          class="justify-start"
          @click="choose(list.id)"
          >{{ list.name }}{{ list.active ? ` — ${t("changelist.active")}` : "" }}</Button
        >
      </div>
      <Button variant="outline" @click="choose(null)">{{ t("common.cancel") }}</Button>
    </section>
  </div>
</template>
