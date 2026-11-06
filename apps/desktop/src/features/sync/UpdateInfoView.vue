<script setup lang="ts">
import { useSyncStore } from "@/stores/syncStore";

const sync = useSyncStore();
</script>

<template>
  <div class="flex h-full min-h-0 flex-col p-2 text-sm">
    <div v-if="!sync.lastUpdate" class="p-4 text-xs text-muted-foreground">
      No update info yet. Run Update Project or Pull to populate this tab.
    </div>
    <template v-else>
      <div class="border-b px-2 py-1 text-xs text-muted-foreground">
        {{ sync.lastUpdate.strategy }} · {{ sync.lastUpdate.message }}
        <span class="font-mono"> ({{ sync.lastUpdate.oldHead.slice(0, 7) }} → {{ sync.lastUpdate.newHead.slice(0, 7) }})</span>
      </div>
      <div class="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-hidden p-2">
        <div class="min-h-0 overflow-auto rounded border p-2">
          <div class="mb-1 text-[11px] font-medium uppercase text-muted-foreground">Files</div>
          <div v-if="!sync.lastUpdate.updatedFiles.length" class="text-xs text-muted-foreground">No file changes</div>
          <div
            v-for="f in sync.lastUpdate.updatedFiles"
            :key="f.path"
            class="font-mono text-[11px]"
          >
            <span class="mr-2 text-muted-foreground">{{ f.status }}</span>{{ f.path }}
          </div>
        </div>
        <div class="min-h-0 overflow-auto rounded border p-2">
          <div class="mb-1 text-[11px] font-medium uppercase text-muted-foreground">Commits</div>
          <div v-if="!sync.lastUpdate.commits.length" class="text-xs text-muted-foreground">No commits</div>
          <div v-for="c in sync.lastUpdate.commits" :key="c" class="font-mono text-[11px]">{{ c }}</div>
        </div>
      </div>
    </template>
  </div>
</template>
