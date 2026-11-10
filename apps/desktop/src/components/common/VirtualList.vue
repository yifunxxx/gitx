<script setup lang="ts" generic="T">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    items: T[];
    itemHeight: number;
    getItemHeight?: (item: T, index: number) => number;
    overscan?: number;
    preserveScrollAnchor?: boolean;
    /** Reuse slot VNodes by window index instead of item identity (cuts SVG remount thrash). */
    recycleKeys?: boolean;
    getKey: (item: T, index: number) => string | number;
  }>(),
  { overscan: 10, recycleKeys: false },
);

const emit = defineEmits<{
  scroll: [event: Event];
}>();

const root = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportH = ref(400);
/** True while the primary mouse button is held (native scrollbar thumb drag). */
const pointerDown = ref(false);

// Optional known heights let expandable rows share the same bounded scrollport.
// Build offsets only when data/heights change; scrolling uses a binary lookup.
const offsets = computed(() => {
  if (!props.getItemHeight) return null;
  const result = [0];
  props.items.forEach((item, index) => {
    result.push(result[index]! + Math.max(1, props.getItemHeight!(item, index)));
  });
  return result;
});
function rowAt(top: number, positions = offsets.value, height = props.itemHeight) {
  if (!positions) return Math.max(0, Math.floor(top / height));
  let low = 0;
  let high = positions.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (positions[mid]! <= top) low = mid;
    else high = mid - 1;
  }
  return Math.min(low, Math.max(0, positions.length - 2));
}
const rowTop = (index: number) => offsets.value?.[index] ?? index * props.itemHeight;
const rowHeight = (index: number) =>
  offsets.value ? offsets.value[index + 1]! - offsets.value[index]! : props.itemHeight;
const totalH = computed(() => offsets.value?.at(-1) ?? props.items.length * props.itemHeight);

const start = computed(() => Math.max(0, rowAt(scrollTop.value) - props.overscan));

const end = computed(() =>
  Math.min(props.items.length, rowAt(scrollTop.value + viewportH.value) + 1 + props.overscan),
);

const visible = computed(() => {
  const out: { item: T; index: number }[] = [];
  for (let i = start.value; i < end.value; i++) {
    const item = props.items[i];
    if (item !== undefined) out.push({ item, index: i });
  }
  return out;
});

const offsetY = computed(() => rowTop(start.value));

let ro: ResizeObserver | null = null;
let raf = 0;
let pendingScroll: Event | null = null;
let scrollGeneration = 0;

function flushScroll() {
  raf = 0;
  const el = root.value;
  const ev = pendingScroll;
  pendingScroll = null;
  if (!el) return;
  // Read from the element so we stay in sync with native thumb drag.
  scrollTop.value = el.scrollTop;
  if (ev) emit("scroll", ev);
}

function onScroll(e: Event) {
  ++scrollGeneration;
  pendingScroll = e;
  if (raf) return;
  raf = requestAnimationFrame(flushScroll);
}

function onPointerDown(e: PointerEvent) {
  if (e.button === 0) pointerDown.value = true;
}

function onPointerUp() {
  const wasDown = pointerDown.value;
  pointerDown.value = false;
  // Emit a trailing scroll after thumb release so parents (e.g. Log load-more)
  // can react without fighting the drag.
  if (wasDown && root.value) {
    // Dispatch from the scrollport so event.target remains usable by consumers.
    root.value.dispatchEvent(new Event("scroll"));
  }
}

onMounted(() => {
  const el = root.value;
  if (!el) return;
  viewportH.value = el.clientHeight || 400;
  ro = new ResizeObserver(() => {
    if (root.value) viewportH.value = root.value.clientHeight || 400;
  });
  ro.observe(el);
  // Track mouse-up globally so scrollbar thumb drag end is detected even
  // when the pointer leaves the list (Windows native scrollbar).
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("blur", onPointerUp);
});

onUnmounted(() => {
  ro?.disconnect();
  ro = null;
  if (raf) cancelAnimationFrame(raf);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
  window.removeEventListener("blur", onPointerUp);
  pendingScroll = null;
});

watch(
  [() => props.items, () => props.items.length, offsets, () => props.itemHeight],
  async ([items], [previous, , oldOffsets, oldHeight]) => {
    // Keep scrollTop valid when the list shrinks (e.g. filter reset).
    // Skip while the user is dragging the scrollbar — clamping mid-drag
    // fights the native thumb and feels like a "stick"/jam.
    if (pointerDown.value) return;
    const previousTop = root.value?.scrollTop ?? scrollTop.value;
    const generation = scrollGeneration;
    const oldIndex = rowAt(previousTop, oldOffsets, oldHeight);
    const oldItem = previous[oldIndex];
    const key = oldItem === undefined ? null : props.getKey(oldItem, oldIndex);
    const newIndex =
      props.preserveScrollAnchor && key !== null
        ? items.findIndex((item, index) => props.getKey(item, index) === key)
        : -1;
    await nextTick();
    if (
      pointerDown.value ||
      props.items !== items ||
      !root.value ||
      generation !== scrollGeneration
    )
      return;
    if (newIndex >= 0) {
      const oldTop = oldOffsets?.[oldIndex] ?? oldIndex * oldHeight;
      root.value.scrollTop =
        rowTop(newIndex) + Math.min(previousTop - oldTop, rowHeight(newIndex) - 1);
      scrollTop.value = root.value.scrollTop;
    }
    const max = Math.max(0, totalH.value - viewportH.value);
    if (scrollTop.value > max && root.value) {
      root.value.scrollTop = max;
      scrollTop.value = max;
    }
  },
);

defineExpose({
  el: root,
  pointerDown,
  scrollToIndex(index: number, align: "nearest" | "center" = "nearest") {
    if (!root.value || !props.items.length) return;
    ++scrollGeneration;
    index = Math.max(0, Math.min(index, props.items.length - 1));
    const top = rowTop(index);
    const bottom = top + rowHeight(index);
    if (align === "center")
      root.value.scrollTop = Math.max(0, top - (root.value.clientHeight - props.itemHeight) / 2);
    else if (top < root.value.scrollTop) root.value.scrollTop = top;
    else if (bottom > root.value.scrollTop + root.value.clientHeight) {
      root.value.scrollTop = bottom - root.value.clientHeight;
    }
    scrollTop.value = root.value.scrollTop;
  },
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      ref="root"
      class="min-h-0 flex-1 overflow-auto [overflow-anchor:none]"
      @scroll.passive="onScroll"
      @pointerdown="onPointerDown"
    >
      <!--
        Phantom spacer owns scrollHeight. The window is position:absolute so
        mid-drag virtualization re-renders cannot change layout flow / scrollHeight
        (the classic native-scrollbar thumb "stick" with transform-only lists).
      -->
      <div class="relative w-full" :style="{ height: `${totalH}px` }">
        <div
          class="absolute left-0 right-0 top-0 will-change-transform"
          :style="{ transform: `translate3d(0, ${offsetY}px, 0)` }"
        >
          <div
            v-for="(row, slot) in visible"
            :key="recycleKeys ? slot : getKey(row.item, row.index)"
            class="[contain:layout_paint]"
            :style="{ height: `${rowHeight(row.index)}px` }"
          >
            <slot :item="row.item" :index="row.index" />
          </div>
        </div>
      </div>
    </div>
    <!-- Footer outside the scrollport so it does not inflate scrollHeight mid-drag. -->
    <slot name="footer" />
  </div>
</template>
