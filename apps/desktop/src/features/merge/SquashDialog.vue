<script setup lang="ts">
import { ref } from "vue";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";
import { useRewriteStore } from "@/stores/rewriteStore";

const props = defineProps<{ shas: string[]; initialMessage?: string }>();
const rewrite = useRewriteStore();
const message = ref(props.initialMessage ?? "Squashed commits");

async function ok() {
  if (!message.value.trim()) return;
  await rewrite.squash(props.shas, message.value.trim());
  closeDialog(true);
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-lg rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">Squash Commits</h2>
      <p class="mt-1 text-xs text-muted-foreground">{{ shas.length }} commits selected</p>
      <textarea
        v-model="message"
        class="mt-3 min-h-[100px] w-full rounded-md border bg-background p-2 font-mono text-[12.5px]"
      />
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(false)">Cancel</Button>
        <Button size="sm" :disabled="!message.trim() || rewrite.busy" @click="ok">Squash</Button>
      </div>
    </div>
  </div>
</template>
