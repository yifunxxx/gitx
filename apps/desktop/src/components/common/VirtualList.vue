<script setup lang="ts" generic="T">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type ObjectDirective,
} from "vue";
import { isPerfLogEnabled, perfLog } from "@/lib/longTaskLog";

const props = withDefaults(
  defineProps<{
    items: T[];
    itemHeight: number;
    getItemHeight?: (item: T, index: number) => number;
    /** Minimum extra rows; also keep a viewport of pixels on either side. */
    overscan?: number;
    preserveScrollAnchor?: boolean;
    /** Reuse a bounded pool of row elements across scroll windows. */
    recycleKeys?: boolean;
    scrollTabindex?: number;
    getKey: (item: T, index: number) => string | number;
  }>(),
  { overscan: 10, recycleKeys: false },
);

const emit = defineEmits<{
  scroll: [event: Event];
}>();

const root = ref<HTMLElement | null>(null);
const windowEl = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportH = ref(400);
/** True while the primary mouse button is held (native scrollbar thumb drag). */
const pointerDown = ref(false);
/**
 * While true, row hover paint and native `title` tooltips are suppressed so
 * rows sliding under a stationary cursor do not restyle / tooltip each frame.
 * Pointer events stay enabled so clicks and selection keep working.
 * Cleared ~150ms after the last scroll event once the primary button is up.
 */
const scrolling = ref(false);
let scrollIdleTimer = 0;
let scrollBlockStartedMs = 0;
const SCROLL_IDLE_MS = 150;
const TITLE_HOLD = "data-vl-title";
let titleObserver: MutationObserver | null = null;

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

// Native compositor scrolling can show a new position before JS receives the
// scroll event. Keep a viewport ready in both directions, including reversals.
// Row-count overscan remains a minimum; variable-height rows use pixel offsets
// so a few tall rows do not multiply the buffer unnecessarily.
const start = computed(() =>
  Math.max(
    0,
    Math.min(rowAt(scrollTop.value) - props.overscan, rowAt(scrollTop.value - viewportH.value)),
  ),
);

const end = computed(() =>
  Math.min(
    props.items.length,
    Math.max(
      rowAt(scrollTop.value + viewportH.value) + 1 + props.overscan,
      rowAt(scrollTop.value + 2 * viewportH.value) + 1,
    ),
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

// A fixed-height window spans the viewport plus its largest buffer on each side.
// Indexing the pool by absolute row preserves overlapping cells on a one-row scroll.
const poolSize = computed(() => {
  const viewportRows = Math.ceil(viewportH.value / props.itemHeight);
  return viewportRows + 1 + 2 * Math.max(props.overscan, viewportRows);
});
function rowKey(item: T, index: number, slot: number) {
  if (!props.recycleKeys) return props.getKey(item, index);
  return props.getItemHeight ? slot : index % poolSize.value;
}

// A recycled button must never keep keyboard focus after changing its target.
// Move focus before patching the row, without scrolling back to its old offset.
let unmounting = false;
onBeforeUnmount(() => {
  unmounting = true;
});
function releaseRowFocus(row: HTMLElement) {
  if (unmounting || !props.recycleKeys || !root.value) return;
  const active = row.ownerDocument.activeElement;
  if (active && row.contains(active)) root.value.focus({ preventScroll: true });
}
const vRowIdentity: ObjectDirective<HTMLElement, string | number> = {
  beforeUpdate(row, { value, oldValue }) {
    if (value !== oldValue) releaseRowFocus(row);
  },
  beforeUnmount: releaseRowFocus,
};

const offsetY = computed(() => rowTop(start.value));

let ro: ResizeObserver | null = null;
let raf = 0;
let pendingScroll: Event | null = null;
let scrollGeneration = 0;

/** Parents (load-more) read metrics from event.target — must be the scrollport. */
function emitScrollFromPort() {
  if (!root.value) return;
  const ev = new Event("scroll");
  Object.defineProperty(ev, "target", { configurable: true, value: root.value });
  emit("scroll", ev);
}

function applyScrollTop(top: number, ev: Event | null) {
  scrollTop.value = top;
  if (ev) emit("scroll", ev);
  else emitScrollFromPort();
}

function flushScroll() {
  raf = 0;
  const el = root.value;
  const ev = pendingScroll;
  pendingScroll = null;
  if (!el) return;
  const top = el.scrollTop;
  // Re-read for programmatic moves since the last event. Row rendering already
  // follows native scroll events; only parent work is deferred to this frame.
  if (pointerDown.value) {
    scrollTop.value = top;
    return;
  }
  applyScrollTop(top, ev);
}

function stripTitles(target: HTMLElement, updates: MutationRecord[] = []) {
  // Vue may clear or replace a recycled row's title while it is suppressed.
  // Consume those writes before scanning newly mounted descendants.
  for (const update of updates) {
    if (update.type !== "attributes" || !(update.target instanceof HTMLElement)) continue;
    const el = update.target;
    if (!target.contains(el)) continue;
    const text = el.getAttribute("title");
    if (text === null) el.removeAttribute(TITLE_HOLD);
    else el.setAttribute(TITLE_HOLD, text);
  }
  for (const el of target.querySelectorAll<HTMLElement>("[title]")) {
    const text = el.getAttribute("title");
    if (text === null) continue;
    if (text !== "" || !el.hasAttribute(TITLE_HOLD)) el.setAttribute(TITLE_HOLD, text);
    // An empty attribute suppresses native tooltips but still lets a later
    // removeAttribute produce a mutation, unlike an already absent title.
    if (text !== "") el.setAttribute("title", "");
  }
  // Discard records produced by our own empty-title writes.
  titleObserver?.takeRecords?.();
}

function restoreTitles(target: HTMLElement) {
  for (const el of target.querySelectorAll<HTMLElement>(`[${TITLE_HOLD}]`)) {
    const text = el.getAttribute(TITLE_HOLD);
    if (text !== null) el.setAttribute("title", text);
    el.removeAttribute(TITLE_HOLD);
  }
}

function startTitleSuppress() {
  const target = windowEl.value;
  if (!target) return;
  stripTitles(target);
  if (titleObserver) return;
  titleObserver = new MutationObserver((updates) => {
    if (windowEl.value) stripTitles(windowEl.value, updates);
  });
  titleObserver.observe(target, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title"],
  });
}

function stopTitleSuppress() {
  const updates = titleObserver?.takeRecords() ?? [];
  if (windowEl.value && updates.length) stripTitles(windowEl.value, updates);
  titleObserver?.disconnect();
  titleObserver = null;
  if (windowEl.value) restoreTitles(windowEl.value);
}

function markScrolling() {
  if (!scrolling.value) {
    scrolling.value = true;
    scrollBlockStartedMs = performance.now();
    startTitleSuppress();
    if (isPerfLogEnabled()) perfLog("debug", "VirtualList scroll: suppress hover/title");
  }
  if (scrollIdleTimer) window.clearTimeout(scrollIdleTimer);
  scrollIdleTimer = window.setTimeout(clearScrolling, SCROLL_IDLE_MS);
}

function clearScrolling() {
  scrollIdleTimer = 0;
  // Keep hover/title suppress while the thumb is held — moving into list
  // content mid-drag must not re-enter :hover / title tooltip paths.
  if (pointerDown.value) {
    scrollIdleTimer = window.setTimeout(clearScrolling, SCROLL_IDLE_MS);
    return;
  }
  if (!scrolling.value) return;
  const ms = performance.now() - scrollBlockStartedMs;
  scrolling.value = false;
  stopTitleSuppress();
  if (isPerfLogEnabled() || ms >= 100) {
    perfLog(ms >= 100 ? "info" : "debug", `VirtualList scroll idle ${ms.toFixed(0)}ms`);
  }
}

function onScroll(e: Event) {
  // The compositor can scroll past the old overscan before our next rAF.
  // Publish the current position now so Vue can patch rows at this event's
  // microtask checkpoint. Burst events still share Vue's queued update, and
  // pagination remains coalesced below (and paused while the thumb is held).
  if (root.value) scrollTop.value = root.value.scrollTop;
  markScrolling();
  ++scrollGeneration;
  pendingScroll = e;
  if (raf) return;
  raf = requestAnimationFrame(flushScroll);
}

function onPointerDown(e: PointerEvent) {
  // Track primary-button hold to defer pagination and anchor changes only.
  // Do NOT suppress hover/title here — that ran on every row click in v0.1.29
  // and, combined with pointer-events:none, swallowed selection entirely.
  if (e.button === 0) pointerDown.value = true;
}

function endPointerGesture(ev?: Event) {
  // Losing capture while the button remains held must not resume pagination
  // or anchor changes that would move the native thumb under the pointer.
  if (
    ev &&
    "buttons" in ev &&
    typeof (ev as PointerEvent).buttons === "number" &&
    ((ev as PointerEvent).buttons & 1) !== 0
  ) {
    return;
  }
  const wasDown = pointerDown.value;
  pointerDown.value = false;
  if (!wasDown || !root.value) return;
  // Read the current port, never a saved position from an older scroll event.
  applyScrollTop(root.value.scrollTop, null);
  // Thumb drag usually produced scroll events already; refresh the idle timer
  // so hover/title stay suppressed briefly after release.
  if (scrolling.value) markScrolling();
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
  window.addEventListener("pointerup", endPointerGesture);
  window.addEventListener("pointercancel", endPointerGesture);
  window.addEventListener("lostpointercapture", endPointerGesture);
  // blur has no buttons — force-end (window lost focus).
  window.addEventListener("blur", endPointerGestureOnBlur);
});

function endPointerGestureOnBlur() {
  endPointerGesture();
}

onUnmounted(() => {
  ro?.disconnect();
  ro = null;
  if (raf) cancelAnimationFrame(raf);
  if (scrollIdleTimer) window.clearTimeout(scrollIdleTimer);
  stopTitleSuppress();
  window.removeEventListener("pointerup", endPointerGesture);
  window.removeEventListener("pointercancel", endPointerGesture);
  window.removeEventListener("lostpointercapture", endPointerGesture);
  window.removeEventListener("blur", endPointerGestureOnBlur);
  pendingScroll = null;
  scrolling.value = false;
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
    // An unchanged first row does not imply append-only growth: new files or
    // expanded groups may insert rows before the viewport. Check its actual
    // anchor; the same-index shortcut below keeps true appends O(1).
    const oldIndex = rowAt(previousTop, oldOffsets, oldHeight);
    const oldItem = oldIndex >= 0 ? previous[oldIndex] : undefined;
    const key = oldItem === undefined ? null : props.getKey(oldItem, oldIndex);
    const newIndex =
      props.preserveScrollAnchor && key !== null
        ? oldIndex >= 0 &&
          oldIndex < items.length &&
          props.getKey(items[oldIndex]!, oldIndex) === key
          ? oldIndex
          : items.findIndex((item, index) => props.getKey(item, index) === key)
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
      const nextTop = rowTop(newIndex) + Math.min(previousTop - oldTop, rowHeight(newIndex) - 1);
      if (Math.abs(nextTop - root.value.scrollTop) >= 1) {
        root.value.scrollTop = nextTop;
      }
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
  scrolling,
  isIndexVisible: (index: number) => index >= start.value && index < end.value,
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
      :tabindex="scrollTabindex ?? (recycleKeys ? -1 : undefined)"
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
        <!-- Keep rows in the scroller's paint layer. A translated promoted
             window can expose unpainted raster content during fast scrolling. -->
        <div
          ref="windowEl"
          class="vl-window absolute left-0 right-0"
          data-vl-window
          :data-scrolling="scrolling ? '' : undefined"
          :style="{ top: `${offsetY}px` }"
        >
          <div
            v-for="(row, slot) in visible"
            :key="rowKey(row.item, row.index, slot)"
            v-row-identity="getKey(row.item, row.index)"
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

<style scoped>
/*
  Keep pointer-events enabled so row clicks/selection work. While scrolling
  (or thumb-held after a scroll), neutralize the common Tailwind hover paints
  used by Log / Branches / Changes / Shelf rows. Selected rows keep their
  explicit bg-* classes because hover utilities are overridden to transparent
  only when they would otherwise paint a hover surface.
*/
.vl-window[data-scrolling] :deep(.hover\:bg-hover-surface:hover),
.vl-window[data-scrolling] :deep(.hover\:bg-accent:hover),
.vl-window[data-scrolling] :deep(.hover\:bg-accent\/50:hover) {
  background-color: transparent !important;
  box-shadow: none !important;
}

/* Branches rows combine selection + hover:bg-accent — restore selection paint. */
.vl-window[data-scrolling] :deep(.bg-selection\/40.hover\:bg-accent:hover) {
  background-color: rgb(var(--selection)) !important;
}
</style>
