<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from "vue";
import { placeContextMenu, refineMenuPlacement, type MenuPlacement } from "@/lib/contextMenu";

const props = withDefaults(
  defineProps<{
    open: boolean;
    anchorX: number;
    anchorY: number;
    width?: number;
    estimatedHeight?: number;
    minWidthClass?: string;
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

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return;
  if (event.key === "Escape" || event.key === "Tab") {
    event.preventDefault();
    event.stopPropagation();
    emit("close");
    return;
  }
  const items = Array.from(
    panel.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
  );
  if (!items.length) return;
  let index = items.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === "ArrowDown") index = (index + 1) % items.length;
  else if (event.key === "ArrowUp") index = (index - 1 + items.length) % items.length;
  else if (event.key === "Home") index = 0;
  else if (event.key === "End") index = items.length - 1;
  else return;
  event.preventDefault();
  event.stopPropagation();
  items[index]?.focus();
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previousFocus = document.activeElement as HTMLElement | null;
      window.addEventListener("keydown", onKeydown, true);
      await nextTick();
      if (props.open)
        panel.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    } else {
      window.removeEventListener("keydown", onKeydown, true);
      previousFocus?.focus({ preventScroll: true });
      previousFocus = null;
    }
  },
  { immediate: true },
);
onUnmounted(() => window.removeEventListener("keydown", onKeydown, true));
const place = ref<MenuPlacement>(
  placeContextMenu(props.anchorX, props.anchorY, {
    width: props.width,
    estimatedHeight: props.estimatedHeight,
  }),
);

async function syncPlacement() {
  place.value = placeContextMenu(props.anchorX, props.anchorY, {
    width: props.width,
    estimatedHeight: props.estimatedHeight,
  });
  await nextTick();
  const el = panel.value;
  if (!el) return;
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
        class="absolute z-[9999] overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 shadow-lg ring-1 ring-foreground/10 [&_button:disabled]:cursor-default [&_button:disabled]:opacity-50"
        :class="minWidthClass"
        :style="{
          left: `${place.x}px`,
          top: `${place.y}px`,
          maxHeight: `${place.maxHeight}px`,
          // Avoid sub-pixel bleed past the viewport bottom.
          boxSizing: 'border-box',
        }"
        @click.stop
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
