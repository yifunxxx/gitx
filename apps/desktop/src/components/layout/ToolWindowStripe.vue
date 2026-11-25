<script setup lang="ts">
import { useLayoutStore } from "@/stores/layoutStore";
import { useI18n } from "vue-i18n";
import { onBeforeUnmount } from "vue";
import { activeFileDrag } from "@/features/file-tree/fileDrag";

const layout = useLayoutStore();
const { t } = useI18n();
let dragTimer: ReturnType<typeof setTimeout> | undefined;
function hoverCommit(event: DragEvent) {
  if (!activeFileDrag.value) return;
  event.preventDefault();
  if (!dragTimer)
    dragTimer = setTimeout(() => {
      if (activeFileDrag.value) layout.showLeftTab("commit");
    }, 450);
}
function leaveCommit() {
  clearTimeout(dragTimer);
  dragTimer = undefined;
}
onBeforeUnmount(leaveCommit);
</script>

<template>
  <aside
    class="glass-chrome flex w-8 shrink-0 flex-col items-center gap-1 border-r bg-dbx-chrome py-2"
  >
    <button
      type="button"
      :aria-pressed="
        layout.activeLeftTab === 'commit' && (layout.leftOpen || layout.commitTwMode === 'float')
      "
      class="writing-vertical rotate-180 rounded px-1 py-2 text-[10px] tracking-wide text-muted-foreground hover:bg-accent"
      style="writing-mode: vertical-rl"
      :class="
        layout.activeLeftTab === 'commit' && (layout.leftOpen || layout.commitTwMode === 'float')
          ? 'bg-accent text-foreground'
          : ''
      "
      @click="layout.toggleLeftTab('commit')"
      @dragover="hoverCommit"
      @dragleave="leaveCommit"
      @drop.prevent="leaveCommit"
    >
      Commit
    </button>
    <button
      type="button"
      :aria-pressed="layout.activeLeftTab === 'file' && layout.leftOpen"
      class="writing-vertical rotate-180 rounded px-1 py-2 text-[10px] tracking-wide text-muted-foreground hover:bg-accent"
      style="writing-mode: vertical-rl"
      :class="layout.activeLeftTab === 'file' && layout.leftOpen ? 'bg-accent text-foreground' : ''"
      @click="layout.toggleLeftTab('file')"
    >
      {{ t("toolWindows.file") }}
    </button>
    <div class="flex-1" />
    <button
      type="button"
      :aria-pressed="layout.bottomOpen"
      class="rounded px-1 py-2 text-[10px] tracking-wide text-muted-foreground hover:bg-accent"
      style="writing-mode: vertical-rl"
      :class="layout.bottomOpen ? 'bg-accent text-foreground' : ''"
      @click="layout.bottomOpen = !layout.bottomOpen"
    >
      Git
    </button>
  </aside>
</template>
