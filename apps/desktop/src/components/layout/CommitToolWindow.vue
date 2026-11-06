<script setup lang="ts">
import EmptyState from "@/components/common/EmptyState.vue";
import { Button } from "@/components/ui/button";
import { runAction } from "@/actions";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const workspace = useWorkspaceStore();

async function refresh() {
  await runAction("Git.RefreshStatus", {
    repoIds: workspace.toplevel ? [workspace.toplevel] : [],
    selection: {},
    source: "toolbar",
    place: "CommitTW",
    folderPath: workspace.folderPath,
  });
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-sidebar">
    <div class="flex h-8 items-center justify-between border-b px-2 text-xs font-medium">
      <span>Commit</span>
      <Button variant="ghost" size="xs" @click="refresh">Refresh</Button>
    </div>
    <EmptyState
      title="Changes placeholder"
      description="Staging / changelists land in M1. Use Refresh to probe git status."
    >
      <Button size="sm" variant="outline" @click="refresh">Run git status</Button>
    </EmptyState>
  </div>
</template>
