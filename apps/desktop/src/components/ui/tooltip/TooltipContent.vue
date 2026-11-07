<script setup lang="ts">
import { TooltipContent, TooltipPortal, type TooltipContentProps } from "reka-ui";
import { cn } from "@/lib/utils";

const props = withDefaults(defineProps<TooltipContentProps & { class?: string }>(), {
  sideOffset: 4,
  side: "bottom",
});
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      v-bind="props"
      :class="
        cn(
          'z-[200] max-w-xs rounded-md border bg-popover px-2 py-1 text-[11px] leading-4 text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95',
          props.class,
        )
      "
    >
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>
