<script setup lang="ts">
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItemIndicator,
  type DropdownMenuCheckboxItemProps,
} from "reka-ui";
import { Check } from "@lucide/vue";
import { cn } from "@/lib/utils";

const props = defineProps<DropdownMenuCheckboxItemProps & { class?: string }>();
</script>

<template>
  <DropdownMenuCheckboxItem
    v-bind="props"
    :class="
      cn(
        'relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-7 pr-2 text-[13px] leading-4 outline-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        props.class,
      )
    "
  >
    <span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuItemIndicator>
        <Check class="h-3.5 w-3.5" />
      </DropdownMenuItemIndicator>
    </span>
    <slot />
  </DropdownMenuCheckboxItem>
</template>
