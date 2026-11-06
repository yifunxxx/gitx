<script setup lang="ts">
import { ref } from "vue";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";
import { getBackend } from "@/lib/backend";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { toast } from "@/composables/useToast";

const props = defineProps<{ target: string }>();
const name = ref("");
const message = ref("");
const force = ref(false);
const pushRemote = ref(false);

async function ok() {
  const ws = useWorkspaceStore();
  if (!ws.repoPath || !name.value.trim()) return;
  const remotes = useBranchesStore().remotes;
  try {
    await getBackend().tagCreate({
      path: ws.repoPath,
      name: name.value.trim(),
      target: props.target,
      message: message.value.trim() || null,
      force: force.value,
      pushRemote: pushRemote.value ? remotes[0]?.name ?? null : null,
    });
    toast({ title: `Tag ${name.value.trim()} created` });
    closeDialog(true);
  } catch (e) {
    toast({ title: "Tag failed", description: String(e) });
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">New Tag</h2>
      <p class="mt-1 text-[11px] text-muted-foreground">Commit: {{ props.target }}</p>
      <input v-model="name" class="mt-3 h-8 w-full rounded-md border bg-background px-2 text-sm" placeholder="Tag name" autofocus />
      <textarea v-model="message" class="mt-2 h-20 w-full rounded-md border bg-background px-2 py-1 text-sm" placeholder="Message (annotated if non-empty)" />
      <label class="mt-2 flex items-center gap-2 text-xs"><input v-model="force" type="checkbox" /> Force</label>
      <label class="mt-1 flex items-center gap-2 text-xs"><input v-model="pushRemote" type="checkbox" /> Push to remote after creation</label>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(false)">Cancel</Button>
        <Button size="sm" :disabled="!name.trim()" @click="ok">Create</Button>
      </div>
    </div>
  </div>
</template>
