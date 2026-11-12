<script setup lang="ts" generic="T">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { isPerfLogEnabled, perfLog } from "@/lib/longTaskLog";

const props = withDefaults(
  defineProps<{
    items: T[];
    itemHeight: number;
    getItemHeight?: (item: T, index: number) => number;
    overscan?: number;
    preserveScrollAnchor?: boolean;
    /** Reuse slot VNodes by window index instead of item identity (cuts SVG remount thrash). */
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
/** Latest native scrollTop while the thumb is held — applied once on release. */
let heldScrollTop: number | null = null;
/** Wheel/trackpad: latest top waiting for the gated apply. */
let queuedWheelTop: number | null = null;
let wheelGate = 0;
let lastApplyMs = 0;
const WHEEL_APPLY_MS = 50;

/** Parents (load-more) read metrics from event.target — must be the scrollport. */
function emitScrollFromPort() {
  if (!root.value) return;
  const ev = new Event("scroll");
  Object.defineProperty(ev, "target", { configurable: true, value: root.value });
  emit("scroll", ev);
}

function applyScrollTop(top: number, ev: Event | null) {
  scrollTop.value = top;
  lastApplyMs = performance.now();
  if (ev) emit("scroll", ev);
  else emitScrollFromPort();
}

function flushQueuedWheel() {
  wheelGate = 0;
  if (pointerDown.value || !root.value) {
    queuedWheelTop = null;
    return;
  }
  const top = queuedWheelTop ?? root.value.scrollTop;
  queuedWheelTop = null;
  // Emit directly — do not dispatchEvent("scroll") or the wheel gate re-enters.
  applyScrollTop(top, null);
}

function flushScroll() {
  raf = 0;
  const el = root.value;
  const ev = pendingScroll;
  pendingScroll = null;
  if (!el) return;
  const top = el.scrollTop;
  // While the primary button is down (native scrollbar thumb on Windows), the
  // WebView HWND typically owns mouse interaction for this window. Remounting
  // virtual rows every frame blocks the window's input pump → clicks ignored
  // until the long task ends. Defer reactive windowing until pointerup.
  if (pointerDown.value) {
    heldScrollTop = top;
    return;
  }
  // Wheel/trackpad path (no pointerDown): recycleKeys still patches every
  // visible row's props each frame (CommitGraphCell SVG recomputes). Gate
  // reactive applies to ~20Hz so the WebView input pump stays responsive.
  const now = performance.now();
  if (now - lastApplyMs < WHEEL_APPLY_MS) {
    queuedWheelTop = top;
    if (!wheelGate) {
      wheelGate = window.setTimeout(flushQueuedWheel, WHEEL_APPLY_MS - (now - lastApplyMs));
    }
    return;
  }
  applyScrollTop(top, ev);
}

function stripTitles(target: HTMLElement) {
  for (const el of target.querySelectorAll<HTMLElement>("[title]")) {
    const text = el.getAttribute("title");
    if (text === null) continue;
    el.setAttribute(TITLE_HOLD, text);
    el.removeAttribute("title");
  }
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
  titleObserver = new MutationObserver(() => {
    if (windowEl.value) stripTitles(windowEl.value);
  });
  titleObserver.observe(target, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title"],
  });
}

function stopTitleSuppress() {
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
  markScrolling();
  ++scrollGeneration;
  pendingScroll = e;
  if (raf) return;
  raf = requestAnimationFrame(flushScroll);
}

function onPointerDown(e: PointerEvent) {
  // Track primary-button hold for native scrollbar thumb deferral only.
  // Do NOT suppress hover/title here — that ran on every row click in v0.1.29
  // and, combined with pointer-events:none, swallowed selection entirely.
  if (e.button === 0) pointerDown.value = true;
}

function endPointerGesture(ev?: Event) {
  // WebView2 often fires lostpointercapture when the cursor leaves the native
  // scrollbar thumb into list content while the button is still held. Flushing
  // the deferred window then remounts rows mid-drag → hitch. Stay deferred.
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
  const top = heldScrollTop ?? root.value.scrollTop;
  heldScrollTop = null;
  if (wheelGate) {
    window.clearTimeout(wheelGate);
    wheelGate = 0;
  }
  queuedWheelTop = null;
  // One reactive apply after the OS releases the thumb; emit without re-entry.
  applyScrollTop(top, null);
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
  if (wheelGate) window.clearTimeout(wheelGate);
  if (scrollIdleTimer) window.clearTimeout(scrollIdleTimer);
  stopTitleSuppress();
  window.removeEventListener("pointerup", endPointerGesture);
  window.removeEventListener("pointercancel", endPointerGesture);
  window.removeEventListener("lostpointercapture", endPointerGesture);
  window.removeEventListener("blur", endPointerGestureOnBlur);
  pendingScroll = null;
  heldScrollTop = null;
  queuedWheelTop = null;
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
    const headSame =
      previous.length > 0 &&
      items.length > 0 &&
      props.getKey(previous[0] as T, 0) === props.getKey(items[0] as T, 0);
    // Append-only growth (loadMore): pixel scrollTop stays valid — skip O(n) findIndex.
    // Same-length replacements (variable row height) must still re-anchor.
    const appendOnly = headSame && items.length > previous.length;
    const oldIndex = appendOnly ? -1 : rowAt(previousTop, oldOffsets, oldHeight);
    const oldItem = oldIndex >= 0 ? previous[oldIndex] : undefined;
    const key = oldItem === undefined ? null : props.getKey(oldItem, oldIndex);
    const newIndex =
      !appendOnly && props.preserveScrollAnchor && key !== null
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
    heldScrollTop = null;
  },
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col [app-region:no-drag]">
    <div
      ref="root"
      :tabindex="scrollTabindex"
      class="min-h-0 flex-1 overflow-auto [overflow-anchor:none] [app-region:no-drag]"
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
          ref="windowEl"
          class="vl-window absolute left-0 right-0 top-0 will-change-transform"
          data-vl-window
          :data-scrolling="scrolling ? '' : undefined"
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
