<script setup lang="ts">
import { DropdownMenuLabel } from "reka-ui";
import { cn } from "@/lib/utils";

defineProps<{ class?: string }>();
</script>

<template>
  <DropdownMenuLabel
    :class="cn('px-2 py-1.5 text-[11px] font-medium text-muted-foreground', $props.class)"
  >
    <slot />
  </DropdownMenuLabel>
</template>
