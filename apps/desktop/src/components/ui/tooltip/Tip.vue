<script setup lang="ts">
import Tooltip from "./Tooltip.vue";
import TooltipContent from "./TooltipContent.vue";
import TooltipTrigger from "./TooltipTrigger.vue";

withDefaults(
  defineProps<{
    text: string;
    side?: "top" | "right" | "bottom" | "left";
    disabled?: boolean;
  }>(),
  { side: "bottom", disabled: false },
);
</script>

<template>
  <slot v-if="disabled || !text" />
  <Tooltip v-else :delay-duration="350">
    <TooltipTrigger>
      <slot />
    </TooltipTrigger>
    <TooltipContent :side="side">{{ text }}</TooltipContent>
  </Tooltip>
</template>
