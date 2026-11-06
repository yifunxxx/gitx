<script setup lang="ts">
defineProps<{
  title?: string;
  message: string;
}>();
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
    <div class="text-sm font-medium text-destructive">{{ title ?? "Error" }}</div>
    <div class="max-w-md text-xs text-muted-foreground">{{ message }}</div>
    <slot />
  </div>
</template>
