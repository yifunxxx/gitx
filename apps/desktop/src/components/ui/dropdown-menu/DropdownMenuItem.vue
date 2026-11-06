<script setup lang="ts">
import { DropdownMenuItem, type DropdownMenuItemProps } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps<
  DropdownMenuItemProps & { class?: string; destructive?: boolean }
>();
</script>

<template>
  <DropdownMenuItem
    v-bind="props"
    :class="
      cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] leading-4 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-50',
        props.destructive && 'text-destructive data-[highlighted]:text-destructive',
        props.class,
      )
    "
  >
    <slot />
  </DropdownMenuItem>
</template>
