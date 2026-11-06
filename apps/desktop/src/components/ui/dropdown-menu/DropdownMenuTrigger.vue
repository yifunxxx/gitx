<script setup lang="ts">
import { DropdownMenuTrigger, type DropdownMenuTriggerProps } from "reka-ui";

const props = withDefaults(defineProps<DropdownMenuTriggerProps & { class?: string }>(), {
  asChild: true,
});
</script>

<template>
  <DropdownMenuTrigger v-bind="props" :class="props.class">
    <slot />
  </DropdownMenuTrigger>
</template>
