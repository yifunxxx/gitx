<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useFileViewerStore } from "@/stores/fileViewerStore";
import { useFileOperationsStore } from "@/stores/fileOperationsStore";
import { useConflictsStore } from "@/stores/conflictsStore";
import { toast } from "@/composables/useToast";

const { t } = useI18n();
const workspace = useWorkspaceStore();
const viewer = useFileViewerStore();
const operations = useFileOperationsStore();
const conflicts = useConflictsStore();
function hasDrafts() {
  return (
    viewer.tabs.some((tab) => tab.dirty || tab.saving || tab.fileOperationPending) ||
    conflicts.mergeTabs.some((tab) => tab.saving || conflicts.hasUnsavedMergeResult(tab.id))
  );
}
function switchRoot(event: Event) {
  const select = event.target as HTMLSelectElement;
  const id = select.value;
  select.value = workspace.activeRepoId ?? "";
  if (id === workspace.activeRepoId || operations.busy) return;
  if (hasDrafts()) {
    toast({ title: t("fileTree.saveBeforeSwitch") });
    return;
  }
  workspace.setActiveRepo(id);
}
</script>
<template>
  <div class="flex items-center gap-1 border-b px-2 py-1 text-xs">
    <select
      :value="workspace.activeRepoId"
      :aria-label="t('fileTree.activeRepository')"
      :disabled="operations.busy"
      class="min-w-0 flex-1 rounded border bg-background p-1"
      @change="switchRoot"
    >
      <option v-for="root in workspace.roots" :key="root.id" :value="root.id">
        {{ root.displayName }} — {{ root.worktreeRoot }}
      </option>
    </select>
  </div>
</template>
