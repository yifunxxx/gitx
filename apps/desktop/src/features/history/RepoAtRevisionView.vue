<script setup lang="ts">
import { computed } from "vue";
import { Pane, Splitpanes } from "splitpanes";
import { useRepoAtRevStore } from "@/stores/repoAtRevStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useDiffStore } from "@/stores/diffStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { getBackend } from "@/lib/backend";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { Button } from "@/components/ui/button";
import VirtualList from "@/components/common/VirtualList.vue";
import TextViewport from "@/components/common/TextViewport.vue";
import FileTypeIcon from "@/components/files/FileTypeIcon.vue";
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
        <VirtualList
          :key="tab.dir"
          class="h-full text-[12px]"
          :items="tab.entries"
          :item-height="24"
          :get-key="(e) => e.path"
        >
          <template #default="{ item: e }">
            <button
              type="button"
              class="flex h-full w-full cursor-pointer items-center gap-1 px-2 text-left hover:bg-accent/50"
              :class="tab.selectedPath === e.path ? 'bg-accent' : ''"
              @click="store.openEntry(tab, e)"
              @dblclick="store.openEntry(tab, e)"
            >
              <FileTypeIcon :name="e.name" :kind="e.kind === 'tree' ? 'folder' : 'file'" />
              <span class="truncate">{{ e.name }}</span>
            </button>
          </template>
        </VirtualList>
      </Pane>
      <Pane :size="64">
        <TextViewport
          v-if="typeof tab.blob?.text === 'string'"
          :key="`${tab.id}:${tab.rev}:${tab.selectedPath}`"
          :text="tab.blob.text"
          :label="tab.selectedPath || tab.title"
          class="h-full"
        />
        <div v-else-if="tab.blob?.binary" class="p-4 text-xs">
          Binary file ({{ tab.blob.size }} bytes)
        </div>
        <div v-else-if="tab.blob?.tooLarge" class="p-4 text-xs">File too large</div>
        <div v-else class="p-4 text-xs text-muted-foreground">Select a file</div>
      </Pane>
    </Splitpanes>
  </div>
</template>
