<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";
import { folderDisplayName } from "@/lib/workspacePath";

const props = defineProps<{
  currentPath: string;
  nextPath: string;
}>();

const { t } = useI18n();
const currentName = folderDisplayName(props.currentPath) ?? props.currentPath;
const nextName = folderDisplayName(props.nextPath) ?? props.nextPath;

function onEscape(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return;
  event.preventDefault();
  event.stopPropagation();
  closeDialog(null);
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-100"
    @keydown.esc="onEscape"
  >
    <div
      class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg animate-in zoom-in-95 duration-100"
      role="dialog"
      aria-modal="true"
      aria-labelledby="open-project-choice-title"
    >
      <h2 id="open-project-choice-title" class="text-sm font-semibold">
        {{ t("welcome.openProjectTitle") }}
      </h2>
      <p class="mt-2 text-xs text-muted-foreground">
        {{ t("welcome.openProjectMessage", { current: currentName, next: nextName }) }}
      </p>
      <p class="mt-1 truncate text-[11px] text-muted-foreground" :title="props.nextPath">
        {{ props.nextPath }}
      </p>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(null)">
          {{ t("common.cancel") }}
        </Button>
        <Button variant="outline" size="sm" @click="closeDialog('new')">
          {{ t("welcome.openInNewWindow") }}
        </Button>
        <Button size="sm" @click="closeDialog('here')">
          {{ t("welcome.openInThisWindow") }}
        </Button>
      </div>
    </div>
  </div>
</template>
