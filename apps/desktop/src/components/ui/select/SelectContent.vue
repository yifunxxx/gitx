<script setup lang="ts">
import {
  SelectContent,
  SelectPortal,
  SelectViewport,
  type SelectContentProps,
} from "reka-ui";
import { cn } from "@/lib/utils";

const props = withDefaults(defineProps<SelectContentProps & { class?: string }>(), {
  position: "popper",
  sideOffset: 4,
});
</script>

<template>
  <SelectPortal>
    <SelectContent
      v-bind="props"
      :class="
        cn(
          'z-[100] max-h-60 min-w-[var(--reka-select-trigger-width)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95',
          props.class,
        )
      "
    >
      <SelectViewport class="p-1">
        <slot />
      </SelectViewport>
    </SelectContent>
  </SelectPortal>
</template>
