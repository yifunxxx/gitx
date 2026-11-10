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
  () => [el.value, props.indeterminate, props.checked] as const,
  ([element, ind]) => {
    if (element) element.indeterminate = !!ind;
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
