<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
    <div class="text-sm font-medium text-foreground">{{ title }}</div>
    <div v-if="description" class="max-w-sm text-xs text-muted-foreground">
      {{ description }}
    </div>
    <div class="mt-2">
      <slot />
    </div>
  </div>
</template>
