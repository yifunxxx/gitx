<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  checked: boolean;
  indeterminate?: boolean;
  title?: string;
}>();

defineEmits<{ change: [event: Event] }>();

const el = ref<HTMLInputElement | null>(null);

watch(
  () => [props.indeterminate, props.checked] as const,
  ([ind]) => {
    if (el.value) el.value.indeterminate = !!ind;
  },
  { immediate: true },
);
</script>

<template>
  <input
    ref="el"
    type="checkbox"
    class="cursor-pointer accent-foreground"
    :checked="checked"
    :title="title"
    @click.stop
    @change="$emit('change', $event)"
  />
</template>
