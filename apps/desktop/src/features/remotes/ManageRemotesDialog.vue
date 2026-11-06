<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";
import { getBackend } from "@/lib/backend";
import type { RemoteInfo } from "@/lib/backend";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { toast } from "@/composables/useToast";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import { openDialog } from "@/composables/useDialog";

const remotes = ref<RemoteInfo[]>([]);
const name = ref("");
const url = ref("");
const fetchAfter = ref(true);
const editing = ref<string | null>(null);

const ws = useWorkspaceStore();

async function load() {
  if (!ws.repoPath) return;
  remotes.value = await getBackend().remoteList({ path: ws.repoPath });
  fetchAfter.value = useSettingsStore().settings?.git?.fetchOnAddRemote ?? true;
}

async function add() {
  if (!ws.repoPath || !name.value.trim() || !url.value.trim()) return;
  try {
    await getBackend().remoteAdd({
      path: ws.repoPath,
      name: name.value.trim(),
      url: url.value.trim(),
      fetchAfter: fetchAfter.value,
    });
    toast({ title: `Remote ${name.value.trim()} added` });
    name.value = "";
    url.value = "";
    await load();
    await useBranchesStore().refresh();
  } catch (e) {
    toast({ title: "Add remote failed", description: String(e) });
  }
}

async function saveEdit(r: RemoteInfo) {
  if (!ws.repoPath) return;
  await getBackend().remoteEdit({
    path: ws.repoPath,
    name: editing.value ?? r.name,
    newName: r.name,
    url: r.fetchUrl,
    pushUrl: r.pushUrl,
  });
  editing.value = null;
  await load();
  await useBranchesStore().refresh();
}

async function remove(r: RemoteInfo) {
  if (!ws.repoPath) return;
  const preview = await getBackend().remoteRemovePreview({ path: ws.repoPath, name: r.name });
  const ok = await openDialog<boolean>(ConfirmDialog, {
    title: `Remove remote '${r.name}'?`,
    message: `This will remove ${preview.trackingCount} remote-tracking branch(es).`,
    confirmLabel: "Remove",
    destructive: true,
  });
  if (!ok) return;
  await getBackend().remoteRemove({ path: ws.repoPath, name: r.name });
  toast({ title: `Removed ${r.name}` });
  await load();
  await useBranchesStore().refresh();
}

onMounted(() => void load());
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="flex max-h-[80vh] w-full max-w-xl flex-col rounded-lg border bg-popover p-4 shadow-lg">
      <div class="flex items-center">
        <h2 class="text-sm font-semibold">Manage Remotes</h2>
        <div class="flex-1" />
        <Button size="xs" variant="ghost" @click="closeDialog()">Close</Button>
      </div>

      <div class="mt-3 min-h-0 flex-1 overflow-auto">
        <table class="w-full text-left text-xs">
          <thead class="text-muted-foreground">
            <tr>
              <th class="py-1 font-medium">Name</th>
              <th class="py-1 font-medium">URL</th>
              <th class="py-1" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in remotes" :key="r.name" class="border-t">
              <td class="py-1.5 pr-2 align-top">
                <input
                  v-if="editing === r.name"
                  v-model="r.name"
                  class="h-7 w-24 rounded border bg-background px-1"
                />
                <span v-else>{{ r.name }}</span>
              </td>
              <td class="py-1.5 pr-2 align-top">
                <input
                  v-if="editing === r.name"
                  v-model="r.fetchUrl"
                  class="h-7 w-full rounded border bg-background px-1 font-mono"
                />
                <span v-else class="font-mono break-all">{{ r.fetchUrl }}</span>
              </td>
              <td class="py-1.5 whitespace-nowrap text-right">
                <Button v-if="editing === r.name" size="xs" @click="saveEdit(r)">Save</Button>
                <Button v-else size="xs" variant="ghost" @click="editing = r.name">Edit</Button>
                <Button size="xs" variant="ghost" class="text-destructive" @click="remove(r)">−</Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-3 border-t pt-3">
        <div class="text-[11px] font-medium text-muted-foreground">Add Remote</div>
        <div class="mt-2 flex gap-2">
          <input v-model="name" class="h-8 w-28 rounded-md border bg-background px-2 text-sm" placeholder="origin" />
          <input v-model="url" class="h-8 flex-1 rounded-md border bg-background px-2 text-sm font-mono" placeholder="https://…" />
          <Button size="sm" @click="add">+</Button>
        </div>
        <label class="mt-2 flex items-center gap-2 text-xs">
          <input v-model="fetchAfter" type="checkbox" /> Fetch remote after adding
        </label>
      </div>
    </div>
  </div>
</template>
