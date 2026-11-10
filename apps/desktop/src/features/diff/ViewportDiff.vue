<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { DiffHunk } from "@/lib/backend";
import type { DiffPaneSnapshot, DiffPaneViewState } from "./diffViewState";
import CodeMirrorDiff from "./CodeMirrorDiff.vue";

const props = defineProps<{ hunks: DiffHunk[] }>();
const host = ref<HTMLElement | null>(null);
const visible = ref(false);
const near = ref(false);
const preview = computed(() => {
  const lines: string[] = [];
  for (const hunk of props.hunks) {
    lines.push(hunk.header.slice(0, 400));
    for (const line of hunk.lines) {
      lines.push(line.slice(0, 400));
      if (lines.length >= 10) return lines.join("\n");
    }
    if (lines.length >= 10) break;
  }
  return lines.join("\n");
});
const saved = shallowRef<DiffPaneViewState>();
const version = ref(0);
let observer: IntersectionObserver | undefined;
let pending: ReturnType<typeof setTimeout> | undefined;
watch(
  () => props.hunks,
  () => {
    version.value++;
    saved.value = undefined;
  },
  { flush: "sync" },
);
function save(snapshot: DiffPaneSnapshot) {
  if (snapshot.key === String(version.value)) saved.value = snapshot.state;
}
onMounted(() => {
  if (!host.value || typeof IntersectionObserver === "undefined") {
    visible.value = true;
    return;
  }
  observer = new IntersectionObserver(
    ([entry]) => {
      near.value = !!entry?.isIntersecting;
      if (pending) clearTimeout(pending);
      pending = undefined;
      if (!near.value) visible.value = false;
      // A fast thumb drag may pass many files in one frame. Show bounded text
      // immediately, and construct editors only for files that stay nearby.
      else if (!visible.value)
        pending = setTimeout(() => {
          visible.value = true;
          pending = undefined;
        }, 60);
    },
    {
      root: host.value.closest("[data-diff-scrollport]"),
      rootMargin: "240px 0px",
    },
  );
  observer.observe(host.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  if (pending) clearTimeout(pending);
});
</script>

<template>
  <div ref="host" class="h-48">
    <CodeMirrorDiff
      v-if="visible"
      side="unified"
      unified
      :text="''"
      :hunks="hunks"
      :paint-key="String(version)"
      :initial-view-state="saved"
      @save-view-state="save"
    />
    <pre
      v-else-if="near"
      aria-busy="true"
      class="h-full overflow-hidden px-2 font-mono text-[12px] leading-[18px]"
      >{{ preview }}</pre>
  </div>
</template>
