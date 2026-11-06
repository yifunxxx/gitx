<script setup lang="ts">
import { computed } from "vue";
import { Pane, Splitpanes } from "splitpanes";
import { useCompareStore } from "@/stores/compareStore";
import { Button } from "@/components/ui/button";
import { statusClass } from "@/features/commit/statusColor";
import type { ChangedFile, FileChangeKind } from "@/lib/backend";
import CodeMirrorDiff from "@/features/diff/CodeMirrorDiff.vue";
import PathTreeList from "@/components/files/PathTreeList.vue";

const props = defineProps<{ tabId: string }>();
const compare = useCompareStore();
const tab = computed(() => compare.tabs.find((t) => t.id === props.tabId));

function mapStatus(s: string): FileChangeKind {
  switch (s) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "modified";
  }
}

function openCompareFile(f: ChangedFile) {
  if (!tab.value) return;
  compare.openFile(tab.value, f.path, f.origPath);
}
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col">
    <div class="flex h-8 items-center gap-2 border-b bg-dbx-chrome px-2 text-xs">
      <span class="font-medium">{{ tab.title }}</span>
      <span class="font-mono text-muted-foreground">{{ tab.left }} → {{ tab.right }}</span>
      <div class="flex-1" />
      <Button size="xs" variant="ghost" @click="compare.swap(tab.id)">Swap</Button>
      <Button size="xs" variant="outline" @click="compare.showCombined(tab)">
        Show Combined Diff
      </Button>
      <Button size="xs" variant="ghost" @click="compare.reload(tab)">Refresh</Button>
    </div>
    <div v-if="tab.loading" class="p-4 text-xs text-muted-foreground">Loading…</div>
    <div v-else-if="tab.error" class="p-4 text-xs text-destructive">{{ tab.error }}</div>
    <Splitpanes v-else class="min-h-0 flex-1">
      <Pane v-if="tab.mode === 'refs'" :size="36" min-size="20">
        <div class="flex h-full min-h-0 flex-col text-[12px]">
          <div class="border-b px-2 py-1 text-[11px] font-medium">
            In {{ tab.right }} not in {{ tab.left }}
          </div>
          <div class="min-h-0 flex-1 overflow-auto border-b">
            <div v-for="c in tab.rightOnly" :key="c.sha" class="truncate px-2 py-0.5">
              {{ c.shortSha }} {{ c.subject }}
            </div>
            <div v-if="!tab.rightOnly.length" class="px-2 py-3 text-muted-foreground">
              No unique commits
            </div>
          </div>
          <div class="border-b px-2 py-1 text-[11px] font-medium">
            In {{ tab.left }} not in {{ tab.right }}
          </div>
          <div class="min-h-0 flex-1 overflow-auto">
            <div v-for="c in tab.leftOnly" :key="c.sha" class="truncate px-2 py-0.5">
              {{ c.shortSha }} {{ c.subject }}
            </div>
            <div v-if="!tab.leftOnly.length" class="px-2 py-3 text-muted-foreground">
              No unique commits
            </div>
          </div>
        </div>
      </Pane>
      <Pane :size="tab.mode === 'refs' ? 28 : 40" min-size="20">
        <div class="flex h-full min-h-0 flex-col">
          <div class="border-b px-2 py-1 text-[11px] font-medium">Changed Files</div>
          <PathTreeList
            :files="tab.files"
            :status-class="(f: ChangedFile) => statusClass(mapStatus(f.status))"
            empty-text="Branches are identical / no file differences"
            @select="openCompareFile"
            @open="openCompareFile"
          />
        </div>
      </Pane>
      <Pane v-if="tab.combined" :size="tab.mode === 'refs' ? 36 : 60">
        <div class="h-full overflow-auto">
          <div v-for="f in tab.combined.files" :key="f.path" class="border-b">
            <div class="sticky top-0 bg-muted/80 px-2 py-1 text-[11px] font-medium">
              {{ f.path }}
            </div>
            <div v-if="f.binary" class="px-2 py-1 text-[11px] text-muted-foreground">Binary</div>
            <div v-else-if="f.hunks.length" class="h-48">
              <CodeMirrorDiff side="unified" unified :text="''" :hunks="f.hunks" />
            </div>
          </div>
        </div>
      </Pane>
    </Splitpanes>
  </div>
</template>
