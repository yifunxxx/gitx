<script setup lang="ts">
import { useLayoutStore } from "@/stores/layoutStore";

const layout = useLayoutStore();
</script>

<template>
  <aside class="flex w-8 shrink-0 flex-col items-center gap-1 border-r bg-dbx-chrome py-2">
    <button
      type="button"
      class="writing-vertical rotate-180 rounded px-1 py-2 text-[10px] tracking-wide text-muted-foreground hover:bg-accent"
      style="writing-mode: vertical-rl"
      :class="layout.leftOpen ? 'bg-accent text-foreground' : ''"
      @click="layout.leftOpen = !layout.leftOpen"
    >
      Commit
    </button>
    <div class="flex-1" />
    <button
      type="button"
      class="rounded px-1 py-2 text-[10px] tracking-wide text-muted-foreground hover:bg-accent"
      style="writing-mode: vertical-rl"
      :class="layout.bottomOpen ? 'bg-accent text-foreground' : ''"
      @click="layout.bottomOpen = !layout.bottomOpen"
    >
      Git
    </button>
  </aside>
</template>
