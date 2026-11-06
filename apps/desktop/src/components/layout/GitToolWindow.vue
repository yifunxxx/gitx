<script setup lang="ts">
import { useLayoutStore } from "@/stores/layoutStore";
import { useConsoleStore } from "@/stores/consoleStore";
import { computed } from "vue";
import LogView from "@/features/log/LogView.vue";
import UpdateInfoView from "@/features/sync/UpdateInfoView.vue";

const layout = useLayoutStore();
const consoleStore = useConsoleStore();

const tabs = [
  { id: "log" as const, label: "Log" },
  { id: "update" as const, label: "Update Info" },
  { id: "console" as const, label: "Console" },
];

const lines = computed(() => consoleStore.lines);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-sidebar">
    <div class="flex h-8 items-center gap-1 border-b px-1">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="rounded px-2 py-1 text-xs"
        :class="
          layout.activeBottomTab === tab.id
            ? 'bg-background text-foreground ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent'
        "
        @click="layout.activeBottomTab = tab.id"
      >
        {{ tab.label }}
      </button>
      <div class="flex-1" />
      <button
        v-if="layout.activeBottomTab === 'console'"
        type="button"
        class="px-2 text-[11px] text-muted-foreground hover:text-foreground"
        @click="consoleStore.clear()"
      >
        Clear
      </button>
    </div>

    <div
      v-if="layout.activeBottomTab === 'console'"
      class="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px]"
    >
      <div v-if="!lines.length" class="text-muted-foreground">
        Console is empty. Git commands appear here as you work.
      </div>
      <div
        v-for="line in lines"
        :key="line.id"
        class="whitespace-pre-wrap break-all"
        :class="{
          'text-info': line.stream === 'cmd',
          'text-foreground': line.stream === 'stdout',
          'text-destructive': line.stream === 'stderr',
        }"
      >
        <span class="mr-2 opacity-50">{{ line.stream }}</span>{{ line.line }}
      </div>
    </div>
    <div v-else-if="layout.activeBottomTab === 'update'" class="min-h-0 flex-1">
      <UpdateInfoView />
    </div>
    <div v-else class="min-h-0 flex-1">
      <LogView />
    </div>
  </div>
</template>
