<script setup lang="ts">
import { formatCommitTime as formatTime } from "@/lib/commitTime";
import { computed } from "vue";
import { Pane, Splitpanes } from "splitpanes";
import { useHistoryStore } from "@/stores/historyStore";
import { useDiffStore } from "@/stores/diffStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { Button } from "@/components/ui/button";
import CodeMirrorDiff from "@/features/diff/CodeMirrorDiff.vue";
import VirtualList from "@/components/common/VirtualList.vue";
import EmptyState from "@/components/common/EmptyState.vue";

const props = defineProps<{ tabId: string }>();
const history = useHistoryStore();
const diffs = useDiffStore();
const layout = useLayoutStore();

const tab = computed(() => history.tabs.find((t) => t.id === props.tabId));

async function compareLocal() {
  if (!tab.value?.selectedSha) return;
  await diffs.openRevDiff(tab.value.filePath, tab.value.selectedSha, "WORKTREE");
  layout.activeEditorKind = "diff";
}
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col">
    <div class="flex h-8 items-center gap-2 border-b bg-dbx-chrome px-2 text-xs">
      <span class="font-medium">{{ tab.title }}</span>
      <div class="flex-1" />
      <label class="flex items-center gap-1 text-[11px]">
        <input
          type="checkbox"
          :checked="tab.allBranches"
          @change="history.toggleAllBranches(tab.id)"
        />
        All branches
      </label>
      <Button size="xs" variant="outline" @click="compareLocal">Compare with Local</Button>
    </div>
    <EmptyState v-if="tab.error" :title="'History failed'" :description="tab.error" />
    <Splitpanes v-else class="min-h-0 flex-1">
      <Pane :size="40" min-size="24">
        <VirtualList
          class="h-full text-[12px]"
          :items="tab.commits"
          :item-height="52"
          :get-key="(c) => c.sha"
          preserve-scroll-anchor
        >
          <template #default="{ item: c }">
            <button
              type="button"
              class="flex h-full w-full min-w-0 flex-col justify-center gap-0.5 border-b px-2 text-left"
              :class="tab.selectedSha === c.sha ? 'bg-accent' : 'hover:bg-accent/40'"
              @click="history.select(tab, c.sha)"
            >
              <span class="truncate font-medium">{{ c.subject }}</span>
              <span
                class="max-w-full truncate text-[11px] text-muted-foreground"
                :title="`${c.author} · ${formatTime(c.authorTime)} · ${c.pathAtCommit}`"
              >
                {{ c.shortSha }} · {{ c.author }} · {{ formatTime(c.authorTime) }}
                <template v-if="c.pathAtCommit !== tab.filePath"> · {{ c.pathAtCommit }} </template>
              </span>
            </button>
          </template>
          <template #footer>
            <button
              v-if="tab.truncated"
              type="button"
              class="w-full py-2 text-xs text-muted-foreground"
              @click="history.load(tab, false)"
            >
              Load more…
            </button>
          </template>
        </VirtualList>
      </Pane>
      <Pane :size="60">
        <div v-if="tab.diff" class="h-full min-h-0">
          <CodeMirrorDiff
            v-if="tab.diff.hunks.length"
            side="unified"
            unified
            :text="''"
            :hunks="tab.diff.hunks"
          />
          <div v-else class="p-4 text-xs text-muted-foreground">No differences</div>
        </div>
        <div v-else class="p-4 text-xs text-muted-foreground">Select a revision</div>
      </Pane>
    </Splitpanes>
  </div>
</template>
