<script setup lang="ts">
import { ref } from "vue";
import { File } from "@lucide/vue";
import VirtualList from "@/components/common/VirtualList.vue";

const props = defineProps<{ paths: string[]; label: string }>();
const emit = defineEmits<{ collapse: [] }>();
const list = ref<{
  el: HTMLElement | null;
  scrollToIndex: (index: number) => void;
} | null>(null);
function onKey(event: KeyboardEvent) {
  if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key === "ArrowLeft" || event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("collapse");
    return;
  }
  const port = list.value?.el;
  if (!port) return;
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    event.stopPropagation();
    list.value?.scrollToIndex(event.key === "Home" ? 0 : props.paths.length - 1);
    return;
  }
  const amount =
    event.key === "ArrowDown"
      ? 24
      : event.key === "ArrowUp"
        ? -24
        : event.key === "PageDown"
          ? port.clientHeight
          : event.key === "PageUp"
            ? -port.clientHeight
            : 0;
  if (!amount) return;
  event.preventDefault();
  event.stopPropagation();
  port.scrollTop += amount;
  port.dispatchEvent(new Event("scroll"));
}
</script>

<template>
  <VirtualList
    ref="list"
    :items="paths"
    :item-height="24"
    :overscan="3"
    :get-key="(_path: string, index: number) => index"
    :style="{ height: `${Math.min(paths.length, 8) * 24}px` }"
    class="mx-8 my-1 min-w-0 flex-none rounded border focus-visible:outline focus-visible:outline-ring"
    role="list"
    :aria-label="label"
    tabindex="0"
    @keydown="onKey"
  >
    <template #default="{ item, index }">
      <div
        role="listitem"
        :aria-posinset="index + 1"
        :aria-setsize="paths.length"
        :title="item"
        class="flex h-6 min-w-0 items-center gap-2 px-2"
      >
        <File class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span class="select-text truncate whitespace-pre font-mono">{{ item }}</span>
      </div>
    </template>
  </VirtualList>
</template>
