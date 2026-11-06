<script setup lang="ts">
import { SelectIcon, SelectTrigger, type SelectTriggerProps } from "reka-ui";
import { ChevronDown } from "@lucide/vue";
import { cn } from "@/lib/utils";

const props = defineProps<SelectTriggerProps & { class?: string }>();
</script>

<template>
  <SelectTrigger
    v-bind="props"
    :class="
      cn(
        'flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )
    "
  >
    <slot />
    <SelectIcon as-child>
      <ChevronDown class="h-3.5 w-3.5 shrink-0 opacity-50" />
    </SelectIcon>
  </SelectTrigger>
</template>
