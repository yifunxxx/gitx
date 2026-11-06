<script setup lang="ts">
import { computed } from "vue";
import { Pane, Splitpanes } from "splitpanes";
import { Folder, File } from "@lucide/vue";
import { useRepoAtRevStore } from "@/stores/repoAtRevStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useDiffStore } from "@/stores/diffStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { getBackend } from "@/lib/backend";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { Button } from "@/components/ui/button";
import { toast } from "@/composables/useToast";

const props = defineProps<{ tabId: string }>();
const store = useRepoAtRevStore();
const history = useHistoryStore();
const diffs = useDiffStore();
const layout = useLayoutStore();
const workspace = useWorkspaceStore();

const tab = computed(() => store.tabs.find((t) => t.id === props.tabId));

async function getToWorktree() {
  if (!tab.value?.selectedPath || !workspace.repoPath || !workspace.repoId) return;
  await getBackend().checkoutPathFromRev({
    repoId: workspace.repoId,
    path: workspace.repoPath,
    rev: tab.value.rev,
    filePath: tab.value.selectedPath,
  });
  toast({ title: "Restored file from revision" });
}

async function showHistory() {
  if (!tab.value?.selectedPath) return;
  await history.openFileHistory(tab.value.selectedPath);
}

async function compareLocal() {
  if (!tab.value?.selectedPath) return;
  await diffs.openRevDiff(tab.value.selectedPath, tab.value.rev, "WORKTREE");
  layout.activeEditorKind = "diff";
}
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col">
    <div class="flex h-8 items-center gap-2 border-b bg-dbx-chrome px-2 text-xs">
      <span class="font-medium">{{ tab.title }}</span>
      <span class="font-mono text-muted-foreground">{{ tab.dir || "/" }}</span>
      <div class="flex-1" />
      <Button size="xs" variant="ghost" :disabled="!tab.dir" @click="store.goUp(tab)">Up</Button>
      <Button size="xs" variant="ghost" :disabled="!tab.selectedPath" @click="showHistory">
        History
      </Button>
      <Button size="xs" variant="ghost" :disabled="!tab.selectedPath" @click="compareLocal">
        Compare with Local
      </Button>
      <Button size="xs" variant="outline" :disabled="!tab.selectedPath" @click="getToWorktree">
        Get
      </Button>
    </div>
    <div v-if="tab.error" class="p-4 text-xs text-destructive">{{ tab.error }}</div>
    <Splitpanes v-else class="min-h-0 flex-1">
      <Pane :size="36" min-size="20">
        <div class="h-full overflow-auto text-[12px]">
          <button
            v-for="e in tab.entries"
            :key="e.path"
            type="button"
            class="flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-accent/50"
            :class="tab.selectedPath === e.path ? 'bg-accent' : ''"
            @click="store.openEntry(tab, e)"
            @dblclick="store.openEntry(tab, e)"
          >
            <Folder v-if="e.kind === 'tree'" class="h-3.5 w-3.5 text-muted-foreground" />
            <File v-else class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="truncate">{{ e.name }}</span>
          </button>
        </div>
      </Pane>
      <Pane :size="64">
        <pre
          v-if="tab.blob?.text"
          class="h-full overflow-auto p-3 font-mono text-[12px] leading-5"
        >{{ tab.blob.text }}</pre>
        <div v-else-if="tab.blob?.binary" class="p-4 text-xs">Binary file ({{ tab.blob.size }} bytes)</div>
        <div v-else-if="tab.blob?.tooLarge" class="p-4 text-xs">File too large</div>
        <div v-else class="p-4 text-xs text-muted-foreground">Select a file</div>
      </Pane>
    </Splitpanes>
  </div>
</template>
