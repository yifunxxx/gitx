<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { Button } from "@/components/ui/button";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { openDialog } from "@/composables/useDialog";
import ConflictsDialog from "./ConflictsDialog.vue";

const rewrite = useRewriteStore();
const workspace = useWorkspaceStore();

const visible = computed(
  () => !!rewrite.opState && rewrite.opState.kind !== "normal",
);

onMounted(() => {
  if (workspace.isRepo) void rewrite.refreshOpState();
});

watch(
  () => workspace.repoPath,
  () => {
    if (workspace.isRepo) void rewrite.refreshOpState();
  },
);

function resolve() {
  void openDialog(ConflictsDialog, {});
}
</script>

<template>
  <div
    v-if="visible && rewrite.opState"
    class="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs"
  >
    <span class="font-medium">{{ rewrite.opState.summary }}</span>
    <span v-if="rewrite.opState.conflictCount" class="text-muted-foreground">
      — {{ rewrite.opState.conflictCount }} conflict(s)
    </span>
    <div class="ml-auto flex flex-wrap gap-1">
      <Button
        v-if="rewrite.opState.conflictCount > 0"
        size="xs"
        variant="outline"
        @click="resolve"
      >
        Resolve Conflicts
      </Button>
      <Button
        v-if="
          rewrite.opState.phase === 'readyToContinue' ||
          rewrite.opState.phase === 'stoppedForEdit' ||
          (rewrite.opState.conflictCount === 0 && rewrite.opState.kind !== 'normal')
        "
        size="xs"
        @click="rewrite.continueOp()"
      >
        {{ rewrite.opState.kind === 'merge' ? 'Commit Merge' : 'Continue' }}
      </Button>
      <Button
        v-if="rewrite.opState.kind === 'rebase' || rewrite.opState.kind === 'cherryPick'"
        size="xs"
        variant="outline"
        @click="rewrite.skip()"
      >
        Skip
      </Button>
      <Button size="xs" variant="ghost" @click="rewrite.abort()">
        Abort
      </Button>
    </div>
  </div>
</template>
