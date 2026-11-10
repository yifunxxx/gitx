<script setup lang="ts">
import { computed } from "vue";
import { Pane, Splitpanes } from "splitpanes";
import { useLayoutStore } from "@/stores/layoutStore";

const layout = useLayoutStore();
const maximized = computed(() => layout.bottomOpen && layout.bottomMaximized);
const bottomSize = computed(() => Math.min(80, Math.max(15, layout.bottomSize)));
function resized(payload: { event?: Event; panes: { size: number }[] }) {
  // Programmatic changes (maximize, hide, restore) must not replace the user's
  // saved split. Both toolbar and divider double-click use the same state.
  if (payload.event && layout.bottomOpen && !maximized.value && payload.panes[1]) {
    layout.bottomSize = Math.min(80, Math.max(15, payload.panes[1].size));
  }
}
</script>

<template>
  <Splitpanes
    class="workspace-panels default-theme h-full"
    :class="{ 'workspace-panels-single': maximized || !layout.bottomOpen }"
    horizontal
    :maximize-panes="false"
    @resized="resized"
    @splitter-dblclick="layout.bottomMaximized = !layout.bottomMaximized"
  >
    <Pane
      key="editor"
      :size="maximized ? 0 : layout.bottomOpen ? 100 - bottomSize : 100"
      :min-size="maximized ? 0 : 20"
      :max-size="maximized ? 0 : 100"
      :aria-hidden="maximized || undefined"
      :inert="maximized || undefined"
      ><slot name="editor"
    /></Pane>
    <Pane
      key="git"
      :size="layout.bottomOpen ? (maximized ? 100 : bottomSize) : 0"
      :min-size="layout.bottomOpen ? 15 : 0"
      :max-size="layout.bottomOpen ? (maximized ? 100 : 80) : 0"
      ><slot v-if="layout.bottomOpen" name="git"
    /></Pane>
  </Splitpanes>
</template>

<style>
/* Stable panes retain their content and avoid splitpanes' add/remove sizing pass. */
.workspace-panels-single > .splitpanes__splitter {
  display: none;
}
.workspace-panels > .splitpanes__pane {
  transition: none;
}
</style>
