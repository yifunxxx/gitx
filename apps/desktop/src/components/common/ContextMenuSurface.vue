<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { placeContextMenu, refineMenuPlacement, type MenuPlacement } from "@/lib/contextMenu";

const props = withDefaults(
  defineProps<{
    open: boolean;
    anchorX: number;
    anchorY: number;
    width?: number;
    estimatedHeight?: number;
    minWidthClass?: string;
    label?: string;
  }>(),
  {
    width: 240,
    estimatedHeight: 320,
    minWidthClass: "min-w-48",
  },
);

const emit = defineEmits<{ close: [] }>();

const panel = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
let ownedPanel: HTMLElement | null = null;
let lastFocused: HTMLElement | null = null;
let observer: MutationObserver | undefined;
let generation = 0;
let disposed = false;
const itemSelector = 'button, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

function visible(element: HTMLElement) {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.hasAttribute("inert") || node.getAttribute("aria-hidden") === "true")
      return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
  }
  return true;
}
function items() {
  return Array.from(panel.value?.querySelectorAll<HTMLElement>(itemSelector) ?? []).filter(
    (item) => item.closest('[role="menu"], [role="dialog"]') === panel.value,
  );
}
function enabledItems() {
  return items().filter(
    (item) =>
      !item.matches(":disabled") && item.getAttribute("aria-disabled") !== "true" && visible(item),
  );
}
function focusItem(item: HTMLElement | undefined) {
  const target = item ?? panel.value;
  target?.focus({ preventScroll: true });
  item?.scrollIntoView?.({ block: "nearest" });
}
function syncItems() {
  for (const item of items()) item.tabIndex = -1;
  const active = document.activeElement;
  const available = enabledItems();
  if (
    (active instanceof HTMLElement && items().includes(active) && !available.includes(active)) ||
    (active === document.body && lastFocused && !lastFocused.isConnected)
  )
    focusItem(available[0]);
}
function restoreFocus() {
  const active = document.activeElement;
  if (
    previousFocus?.isConnected &&
    visible(previousFocus) &&
    (active === document.body || (active && ownedPanel?.contains(active)))
  )
    previousFocus.focus({ preventScroll: true });
}
function endSession() {
  ++generation;
  observer?.disconnect();
  observer = undefined;
  restoreFocus();
  previousFocus = ownedPanel = lastFocused = null;
}
watch(
  () => props.open,
  async (open) => {
    if (!open) {
      endSession();
      return;
    }
    const request = ++generation;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    if (disposed || !props.open || request !== generation || !panel.value) return;
    ownedPanel = panel.value;
    syncItems();
    observer = new MutationObserver(syncItems);
    observer.observe(ownedPanel, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "disabled",
        "aria-disabled",
        "hidden",
        "aria-hidden",
        "inert",
        "style",
        "class",
      ],
    });
    // An intervening dialog/input must retain its focus while the menu mounts.
    if (document.activeElement === previousFocus || document.activeElement === document.body)
      focusItem(enabledItems()[0]);
  },
  { immediate: true },
);

function ownTarget(event: Event) {
  const target = event.target;
  return target instanceof Element &&
    target.closest('[role="menu"], [role="dialog"]') === panel.value
    ? target
    : null;
}
function onKeydown(event: KeyboardEvent) {
  const target = ownTarget(event);
  if (!target) return;
  // The menu owns its keystrokes; global Git shortcuts must not act on the
  // underlying selection, even when no menu command matches.
  event.stopPropagation();
  if (
    event.defaultPrevented ||
    event.isComposing ||
    target.closest('input, textarea, select, [contenteditable="true"]')
  )
    return;
  const activation = event.key === "Enter" || event.key === " ";
  const navigation = ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key);
  if (event.ctrlKey || event.metaKey || event.altKey || (event.shiftKey && event.key !== "Tab")) {
    // Prevent the browser from scrolling a focused command out of view even
    // though a modified key intentionally does not navigate the menu.
    if (activation || navigation) event.preventDefault();
    return;
  }
  if (event.key === "Escape" || event.key === "Tab") {
    event.preventDefault();
    if (!event.repeat) emit("close");
    return;
  }
  const available = enabledItems();
  const index = available.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? available.length - 1
        : event.key === "ArrowDown"
          ? (index + 1) % available.length
          : event.key === "ArrowUp"
            ? index < 0
              ? available.length - 1
              : (index + available.length - 1) % available.length
            : null;
  if (next !== null) {
    event.preventDefault();
    focusItem(available[next]);
  } else if (activation) {
    event.preventDefault();
    if (!event.repeat && index >= 0) available[index]!.click();
  }
}
function onKeyup(event: KeyboardEvent) {
  const target = ownTarget(event);
  if (!target) return;
  event.stopPropagation();
  if (
    !event.isComposing &&
    event.key === " " &&
    !target.closest('input, textarea, select, [contenteditable="true"]')
  )
    event.preventDefault();
}
function onActivate(event: MouseEvent) {
  const item = ownTarget(event)?.closest<HTMLElement>(itemSelector);
  if (item && !enabledItems().includes(item)) {
    event.preventDefault();
    event.stopPropagation();
  } else if (item) {
    // Restore before the action creates a dialog, so that dialog remembers
    // the opener instead of a menu item that is about to be removed.
    restoreFocus();
  }
}
function onPointerMove(event: PointerEvent) {
  if (event.pointerType === "touch") return;
  const item = ownTarget(event)?.closest<HTMLElement>(itemSelector);
  if (item && item !== document.activeElement && enabledItems().includes(item))
    item.focus({ preventScroll: true });
}
onBeforeUnmount(() => {
  disposed = true;
  endSession();
});
const place = ref<MenuPlacement>(
  placeContextMenu(props.anchorX, props.anchorY, {
    width: props.width,
    estimatedHeight: props.estimatedHeight,
  }),
);

async function syncPlacement() {
  const request = generation;
  place.value = placeContextMenu(props.anchorX, props.anchorY, {
    width: props.width,
    estimatedHeight: props.estimatedHeight,
  });
  await nextTick();
  const el = panel.value;
  if (!el || disposed || !props.open || request !== generation) return;
  place.value = refineMenuPlacement(el, props.anchorX, props.anchorY);
}

watch(
  () => [props.open, props.anchorX, props.anchorY, props.estimatedHeight] as const,
  ([open]) => {
    if (open) void syncPlacement();
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[9998]"
      @click="emit('close')"
      @contextmenu.prevent="emit('close')"
    >
      <div
        ref="panel"
        role="menu"
        tabindex="-1"
        :aria-label="label"
        class="context-menu-panel absolute z-[9999] overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 shadow-lg ring-1 ring-foreground/10"
        :class="minWidthClass"
        :style="{
          left: `${place.x}px`,
          top: `${place.y}px`,
          maxHeight: `${place.maxHeight}px`,
          // Avoid sub-pixel bleed past the viewport bottom.
          boxSizing: 'border-box',
        }"
        @click.stop
        @click.capture="onActivate"
        @keydown="onKeydown"
        @keyup="onKeyup"
        @pointermove="onPointerMove"
        @focusin="lastFocused = $event.target as HTMLElement"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu-panel :deep([role="menuitem"]:focus) {
  background: var(--color-accent);
  outline: 1px solid var(--color-ring);
  outline-offset: -1px;
}
.context-menu-panel :deep(button:disabled) {
  cursor: default;
  opacity: 0.5;
}
</style>
