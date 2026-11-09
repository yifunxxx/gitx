<script setup lang="ts">
import { dismissToast, useToasts } from "@/composables/useToast";
import type { ToastAction } from "@/composables/useToast";

const toasts = useToasts();

function onAction(id: string, action: ToastAction) {
  if (action.disabled?.()) return;
  if (action.onClick() !== false) dismissToast(id);
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-6 z-[99999] flex flex-col items-center gap-2 px-4"
  >
    <TransitionGroup
      enter-active-class="transition duration-250 ease-out"
      enter-from-class="translate-y-2 scale-95 opacity-0"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="translate-y-1 scale-95 opacity-0"
    >
      <div
        v-for="t in toasts"
        :key="t.id"
        :class="t.description ? 'w-full max-w-2xl' : 'max-w-sm'"
        class="pointer-events-auto flex items-center gap-3 rounded-lg bg-foreground px-4 py-2 text-sm text-background-solid shadow-lg"
        role="status"
      >
        <div class="min-w-0 flex-1">
          <div class="font-medium">{{ t.title }}</div>
          <div
            v-if="t.description"
            class="max-h-48 overflow-y-auto whitespace-pre-wrap break-words opacity-80"
          >
            {{ t.description }}
          </div>
        </div>
        <button
          v-if="t.action"
          class="shrink-0 text-xs font-medium underline disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          :disabled="t.action.disabled?.()"
          @click="onAction(t.id, t.action)"
        >
          {{ t.action.label }}
        </button>
        <button
          class="shrink-0 text-xs underline opacity-70"
          type="button"
          @click="dismissToast(t.id)"
        >
          {{ $t("common.dismiss") }}
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
