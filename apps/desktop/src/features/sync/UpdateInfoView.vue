<script setup lang="ts">
import { useSyncStore } from "@/stores/syncStore";
import VirtualList from "@/components/common/VirtualList.vue";
import PathTreeList from "@/components/files/PathTreeList.vue";
import type { ChangedFile } from "@/lib/backend";
import { statusClass } from "@/features/commit/statusColor";
import type { FileChangeKind } from "@/lib/backend";

const sync = useSyncStore();

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
</script>

<template>
  <div class="flex h-full min-h-0 flex-col p-2 text-sm">
    <div v-if="!sync.lastUpdate" class="p-4 text-xs text-muted-foreground">
      No update info yet. Run Update Project or Pull to populate this tab.
    </div>
    <template v-else>
      <div class="border-b px-2 py-1 text-xs text-muted-foreground">
        {{ sync.lastUpdate.strategy }} · {{ sync.lastUpdate.message }}
        <span class="font-mono">
          ({{ sync.lastUpdate.oldHead.slice(0, 7) }} → {{ sync.lastUpdate.newHead.slice(0, 7) }})
        </span>
      </div>
      <div class="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-hidden p-2">
        <div class="flex min-h-0 flex-col overflow-hidden rounded-md border">
          <div class="border-b px-2 py-1 text-[11px] font-medium uppercase text-muted-foreground">
            Files
          </div>
          <PathTreeList
            :files="sync.lastUpdate.updatedFiles"
            :status-class="(f: ChangedFile) => statusClass(mapStatus(f.status))"
            empty-text="No file changes"
          />
        </div>
        <div class="flex min-h-0 flex-col overflow-hidden rounded-md border p-2">
          <div class="mb-1 text-[11px] font-medium uppercase text-muted-foreground">Commits</div>
          <div v-if="!sync.lastUpdate.commits.length" class="text-xs text-muted-foreground">
            No commits
          </div>
          <VirtualList
            :items="sync.lastUpdate.commits"
            :item-height="22"
            :get-key="(_c, index) => index"
            class="font-mono text-[11px]"
          >
            <template #default="{ item: c }"
              ><div class="flex h-full min-w-0 items-center" :title="c">
                <span class="truncate">{{ c }}</span>
              </div></template
            >
          </VirtualList>
        </div>
      </div>
    </template>
  </div>
</template>
