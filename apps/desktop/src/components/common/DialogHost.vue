<script setup lang="ts">
import { useDialogState } from "@/composables/useDialog";

const current = useDialogState();
</script>

<template>
  <component
    :is="current.component"
    v-if="current"
    v-bind="current.props"
  />
</template>
