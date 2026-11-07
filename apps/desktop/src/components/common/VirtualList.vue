<script setup lang="ts" generic="T">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    items: T[];
    itemHeight: number;
    overscan?: number;
    getKey: (item: T, index: number) => string | number;
  }>(),
  { overscan: 10 },
);

const emit = defineEmits<{
  scroll: [event: Event];
}>();

const root = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportH = ref(400);

const totalH = computed(() => props.items.length * props.itemHeight);

const start = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / props.itemHeight) - props.overscan),
);

const end = computed(() =>
  Math.min(
    props.items.length,
    Math.ceil((scrollTop.value + viewportH.value) / props.itemHeight) + props.overscan,
  ),
);

const visible = computed(() => {
  const out: { item: T; index: number }[] = [];
  for (let i = start.value; i < end.value; i++) {
    const item = props.items[i];
    if (item !== undefined) out.push({ item, index: i });
  }
  return out;
});

const offsetY = computed(() => start.value * props.itemHeight);

function onScroll(e: Event) {
  const el = e.target as HTMLElement;
  scrollTop.value = el.scrollTop;
  emit("scroll", e);
}

let ro: ResizeObserver | null = null;

onMounted(() => {
  const el = root.value;
  if (!el) return;
  viewportH.value = el.clientHeight || 400;
  ro = new ResizeObserver(() => {
    if (root.value) viewportH.value = root.value.clientHeight || 400;
  });
  ro.observe(el);
});

onUnmounted(() => {
  ro?.disconnect();
  ro = null;
});

watch(
  () => props.items.length,
  () => {
    // Keep scrollTop valid when the list shrinks (e.g. filter reset).
    const max = Math.max(0, totalH.value - viewportH.value);
    if (scrollTop.value > max && root.value) {
      root.value.scrollTop = max;
      scrollTop.value = max;
    }
  },
);

defineExpose({
  el: root,
  scrollToIndex(index: number) {
    if (!root.value) return;
    root.value.scrollTop = Math.max(0, index * props.itemHeight);
  },
});
</script>

<template>
  <div ref="root" class="min-h-0 flex-1 overflow-auto" @scroll.passive="onScroll">
    <div :style="{ height: `${totalH}px`, position: 'relative' }">
      <div :style="{ transform: `translateY(${offsetY}px)` }">
        <div
          v-for="row in visible"
          :key="getKey(row.item, row.index)"
          :style="{ height: `${itemHeight}px` }"
        >
          <slot :item="row.item" :index="row.index" />
        </div>
      </div>
    </div>
    <slot name="footer" />
  </div>
</template>
