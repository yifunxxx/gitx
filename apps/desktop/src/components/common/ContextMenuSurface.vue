<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import {
  placeContextMenu,
  refineMenuPlacement,
  type MenuPlacement,
} from "@/lib/contextMenu";

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
        class="absolute z-[9999] overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 shadow-lg ring-1 ring-foreground/10"
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
