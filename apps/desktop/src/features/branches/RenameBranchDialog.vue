<script setup lang="ts">
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";

const props = defineProps<{ oldName: string; hasUpstream: boolean }>();
const newName = ref(props.oldName);
const unsetUpstream = ref(props.hasUpstream);

const invalid = computed(() => {
  const n = newName.value.trim();
  if (!n || n === props.oldName) return "Enter a different name";
  return null;
});

function ok() {
  if (invalid.value) return;
  closeDialog({ newName: newName.value.trim(), unsetUpstream: unsetUpstream.value });
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">Rename Branch</h2>
      <p class="mt-1 text-[11px] text-muted-foreground">{{ props.oldName }}</p>
      <input
        v-model="newName"
        class="mt-3 h-8 w-full rounded-md border bg-background px-2 text-sm"
        autofocus
        @keydown.enter="ok"
      />
      <label v-if="props.hasUpstream" class="mt-3 flex items-center gap-2 text-xs">
        <input v-model="unsetUpstream" type="checkbox" /> Unset upstream
      </label>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(null)">Cancel</Button>
        <Button size="sm" :disabled="!!invalid" @click="ok">Rename</Button>
      </div>
    </div>
  </div>
</template>
