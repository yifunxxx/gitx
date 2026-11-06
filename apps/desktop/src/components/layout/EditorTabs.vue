<script setup lang="ts">
import EmptyState from "@/components/common/EmptyState.vue";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const workspace = useWorkspaceStore();
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-dbx-content">
    <div class="flex h-8 items-center gap-1 border-b bg-dbx-chrome px-2 text-xs">
      <span
        class="rounded-sm bg-background px-2 py-0.5 text-foreground ring-1 ring-border"
      >
        Welcome
      </span>
      <span class="text-muted-foreground">Diff / File tabs appear after M1</span>
    </div>
    <div class="min-h-0 flex-1">
      <EmptyState
        v-if="!workspace.folderPath"
        title="Welcome to gitx"
        description="Open a folder to detect git and run status into the Console (M0 exit path)."
      />
      <div v-else class="space-y-2 p-6 text-sm">
        <div class="font-medium">Workspace</div>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <dt>Path</dt>
          <dd class="font-mono text-foreground">{{ workspace.folderPath }}</dd>
          <dt>Repository</dt>
          <dd>{{ workspace.isRepo ? "yes" : "no" }}</dd>
          <dt>Git</dt>
          <dd class="font-mono">{{ workspace.gitVersion ?? "…" }}</dd>
        </dl>
      </div>
    </div>
  </section>
</template>
