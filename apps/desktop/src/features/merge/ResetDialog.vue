<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { getBackend, type ResetMode, type ResetPreview } from "@/lib/backend";

const props = defineProps<{ target: string }>();
const rewrite = useRewriteStore();
const workspace = useWorkspaceStore();

const mode = ref<ResetMode>("mixed");
const preview = ref<ResetPreview | null>(null);
const confirmHard = ref(false);

onMounted(async () => {
  if (!workspace.repoPath) return;
  preview.value = await getBackend().resetPreview({
    path: workspace.repoPath,
    target: props.target,
  });
});

async function ok() {
  if (mode.value === "hard" && !confirmHard.value) {
    confirmHard.value = true;
    return;
  }
  await rewrite.reset(props.target, mode.value);
  closeDialog(true);
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">Reset Current Branch to Here</h2>
      <p class="mt-1 font-mono text-[11px] text-muted-foreground">{{ target.slice(0, 12) }}</p>
      <p v-if="preview" class="mt-2 text-xs text-muted-foreground">
        {{ preview.commitsAffected }} commit(s) will move.
        <span v-if="preview.willDiscardLocal"> Local changes may be discarded.</span>
      </p>
      <div class="mt-3 grid gap-2 text-xs">
        <label class="flex items-start gap-2">
          <input v-model="mode" type="radio" value="soft" class="mt-0.5" />
          <span><strong>Soft</strong> — keep all changes staged</span>
        </label>
        <label class="flex items-start gap-2">
          <input v-model="mode" type="radio" value="mixed" class="mt-0.5" />
          <span><strong>Mixed</strong> — keep changes unstaged (default)</span>
        </label>
        <label class="flex items-start gap-2">
          <input v-model="mode" type="radio" value="hard" class="mt-0.5" />
          <span><strong>Hard</strong> — discard all local changes</span>
        </label>
        <label class="flex items-start gap-2">
          <input v-model="mode" type="radio" value="keep" class="mt-0.5" />
          <span><strong>Keep</strong> — keep local changes; fail on conflict</span>
        </label>
      </div>
      <p v-if="mode === 'hard' && confirmHard" class="mt-2 text-xs text-destructive">
        Confirm Hard reset — uncommitted tracked changes will be lost (backup ref is saved).
      </p>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(false)">Cancel</Button>
        <Button
          size="sm"
          :variant="mode === 'hard' ? 'destructive' : 'default'"
          :disabled="rewrite.busy"
          @click="ok"
        >
          {{ mode === "hard" && !confirmHard ? "Continue…" : "Reset" }}
        </Button>
      </div>
    </div>
  </div>
</template>
