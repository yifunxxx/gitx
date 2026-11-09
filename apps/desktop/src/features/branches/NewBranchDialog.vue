<script setup lang="ts">
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";

const props = defineProps<{ startPoint: string }>();
const name = ref("");
const checkout = ref(true);
const force = ref(false);

const invalid = computed(() => {
  const n = name.value.trim();
  if (!n) return "Enter a branch name";
  if (/[\s~^:?*\[\\]/.test(n) || n.startsWith("-") || n.endsWith(".lock") || n.includes("..")) {
    return "Invalid characters in branch name";
  }
  return null;
});

function ok() {
  if (invalid.value) return;
  closeDialog({ name: name.value.trim(), checkout: checkout.value, force: force.value });
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4"
    @keydown.esc.stop="closeDialog(null)"
  >
    <div
      class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-branch-title"
    >
      <h2 id="new-branch-title" class="text-sm font-semibold">Create New Branch</h2>
      <p class="mt-1 text-[11px] text-muted-foreground">from: {{ props.startPoint }}</p>
      <input
        v-model="name"
        class="mt-3 h-8 w-full rounded-md border bg-background px-2 text-sm"
        placeholder="feature/…"
        autofocus
        @keydown.enter="ok"
      />
      <p v-if="invalid && name" class="mt-1 text-[11px] text-destructive">{{ invalid }}</p>
      <label class="mt-3 flex items-center gap-2 text-xs">
        <input v-model="checkout" type="checkbox" /> Checkout branch
      </label>
      <label class="mt-1 flex items-center gap-2 text-xs">
        <input v-model="force" type="checkbox" /> Overwrite existing branch
      </label>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(null)">Cancel</Button>
        <Button size="sm" :disabled="!!invalid" @click="ok">Create</Button>
      </div>
    </div>
  </div>
</template>
