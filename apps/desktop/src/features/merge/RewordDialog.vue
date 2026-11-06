<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useLogStore } from "@/stores/logStore";

const props = defineProps<{ sha: string }>();
const rewrite = useRewriteStore();
const log = useLogStore();
const message = ref("");

onMounted(() => {
  const d = log.details;
  if (d && (d.sha === props.sha || d.sha.startsWith(props.sha) || props.sha.startsWith(d.sha))) {
    message.value = d.body ? `${d.subject}\n\n${d.body}` : d.subject;
  } else {
    message.value = log.commits.find((c) => c.sha === props.sha || c.sha.startsWith(props.sha))?.subject ?? "";
  }
});

async function ok() {
  if (!message.value.trim()) return;
  await rewrite.reword(props.sha, message.value.trim());
  closeDialog(true);
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-lg rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">Edit Commit Message</h2>
      <p class="mt-1 font-mono text-[11px] text-muted-foreground">{{ sha.slice(0, 12) }}</p>
      <textarea
        v-model="message"
        class="mt-3 min-h-[120px] w-full rounded-md border bg-background p-2 font-mono text-[12.5px]"
        spellcheck="false"
      />
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(false)">Cancel</Button>
        <Button size="sm" :disabled="!message.trim() || rewrite.busy" @click="ok">Reword</Button>
      </div>
    </div>
  </div>
</template>
