<script setup lang="ts">
import { computed } from "vue";
import { X } from "@lucide/vue";
import WelcomeView from "@/features/welcome/WelcomeView.vue";
import DiffViewer from "@/features/diff/DiffViewer.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useDiffStore } from "@/stores/diffStore";

const workspace = useWorkspaceStore();
const diffs = useDiffStore();

const activeDiff = computed(() =>
  diffs.activeId ? diffs.tabs.find((t) => t.id === diffs.activeId) : null,
);
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-dbx-content">
    <div class="flex h-8 items-center gap-1 border-b bg-dbx-chrome px-1 text-xs">
      <button
        type="button"
        class="rounded-sm px-2 py-0.5"
        :class="
          !activeDiff
            ? 'bg-background text-foreground ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent'
        "
        @click="diffs.activeId = null"
      >
        {{ workspace.folderPath ? "Workspace" : "Welcome" }}
      </button>
      <button
        v-for="tab in diffs.tabs"
        :key="tab.id"
        type="button"
        class="group flex items-center gap-1 rounded-sm px-2 py-0.5"
        :class="
          diffs.activeId === tab.id
            ? 'bg-background text-foreground ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent'
        "
        @click="diffs.activeId = tab.id"
      >
        <span class="max-w-[140px] truncate">{{ tab.title }}</span>
        <span
          class="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
          @click.stop="diffs.closeTab(tab.id)"
        >
          <X class="h-3 w-3" />
        </span>
      </button>
    </div>

    <div class="min-h-0 flex-1">
      <DiffViewer v-if="activeDiff" :tab-id="activeDiff.id" />
      <WelcomeView v-else-if="!workspace.folderPath" />
      <div v-else class="space-y-2 p-6 text-sm">
        <div class="font-medium">Workspace</div>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <dt>Path</dt>
          <dd class="font-mono text-foreground">{{ workspace.folderPath }}</dd>
          <dt>Repository</dt>
          <dd>{{ workspace.isRepo ? "yes" : "no" }}</dd>
          <dt>Branch</dt>
          <dd>{{ workspace.branch?.head ?? "—" }}</dd>
          <dt>Git</dt>
          <dd class="font-mono">{{ workspace.gitVersion ?? "…" }}</dd>
        </dl>
        <EmptyState
          v-if="workspace.isRepo"
          class="!h-auto !justify-start pt-6"
          title="Ready"
          description="Use the Commit tool window to stage and commit. Double-click a file or press Ctrl+D for Diff. Log is in the Git tool window."
        />
      </div>
    </div>
  </section>
</template>
