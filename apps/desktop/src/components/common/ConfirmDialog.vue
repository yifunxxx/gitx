<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";

const props = defineProps<{
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
}>();

function confirm() {
  closeDialog(true);
}
function cancel() {
  closeDialog(false);
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4"
    @keydown.esc="cancel"
  >
    <div
      class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg"
      role="dialog"
      aria-modal="true"
    >
      <h2 class="text-sm font-semibold">{{ props.title }}</h2>
      <p class="mt-2 text-xs text-muted-foreground">{{ props.message }}</p>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="cancel">Cancel</Button>
        <Button
          size="sm"
          :variant="props.destructive ? 'destructive' : 'default'"
          @click="confirm"
        >
          {{ props.confirmLabel ?? "OK" }}
        </Button>
      </div>
    </div>
  </div>
</template>
