<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { closeDialog, openDialog } from "@/composables/useDialog";
import { useSyncStore } from "@/stores/syncStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { getBackend } from "@/lib/backend";
import type { PushPreview } from "@/lib/backend";
import { toast } from "@/composables/useToast";
import PushRejectedDialog from "./PushRejectedDialog.vue";

const sync = useSyncStore();
const branches = useBranchesStore();
const workspace = useWorkspaceStore();

const preview = ref<PushPreview | null>(null);
const remote = ref("origin");
const branch = ref("main");
const setUpstream = ref(false);
const forceWithLease = ref(false);
const pushTags = ref<"none" | "all" | "current">("none");
const defineName = ref("origin");
const defineUrl = ref("");

onMounted(async () => {
  await branches.refresh();
  preview.value = await sync.previewPush();
  if (preview.value) {
    remote.value = preview.value.remote;
    branch.value = preview.value.refs[0]?.local ?? workspace.branch?.head ?? "main";
    setUpstream.value = preview.value.setUpstream;
  }
});

async function defineRemote() {
  if (!workspace.repoPath || !defineUrl.value.trim()) return;
  await getBackend().remoteAdd({
    path: workspace.repoPath,
    name: defineName.value.trim() || "origin",
    url: defineUrl.value.trim(),
    fetchAfter: false,
  });
  remote.value = defineName.value.trim() || "origin";
  setUpstream.value = true;
  await branches.refresh();
  preview.value = await sync.previewPush(remote.value);
  toast({ title: "Remote defined" });
}

async function ok() {
  if (!preview.value?.hasRemote && !defineUrl.value) {
    toast({ title: "Define a remote first" });
    return;
  }
  try {
    if (!preview.value?.hasRemote) {
      await defineRemote();
    }
    const result = await sync.push({
      remote: remote.value,
      branch: branch.value,
      setUpstream: setUpstream.value,
      forceWithLease: forceWithLease.value,
      pushTags: pushTags.value === "none" ? null : pushTags.value,
    });
    if (result?.rejected) {
      const choice = await openDialog<"rebase" | "merge" | null>(PushRejectedDialog, {
        message: result.message,
      });
      if (choice === "rebase" || choice === "merge") {
        await sync.pull({
          remote: remote.value,
          branch: branch.value,
          rebase: choice === "rebase",
        });
        await sync.push({
          remote: remote.value,
          branch: branch.value,
          setUpstream: false,
          forceWithLease: false,
        });
      }
    }
    closeDialog(true);
  } catch {
    // Error toast from syncStore; keep dialog open.
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-lg rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">Push</h2>

      <div v-if="preview && !preview.hasRemote" class="mt-3 rounded border border-dashed p-3">
        <div class="text-xs font-medium">Define remote</div>
        <div class="mt-2 flex gap-2">
          <input v-model="defineName" class="h-8 w-24 rounded-md border bg-background px-2 text-sm" />
          <input v-model="defineUrl" class="h-8 flex-1 rounded-md border bg-background px-2 text-sm font-mono" placeholder="URL" />
        </div>
        <Button class="mt-2" size="xs" @click="defineRemote">Add & use</Button>
      </div>

      <template v-else>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <label class="text-[11px] text-muted-foreground">Remote
            <Select v-model="remote">
              <SelectTrigger class="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="r in branches.remotes" :key="r.name" :value="r.name">
                  {{ r.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label class="text-[11px] text-muted-foreground">Branch
            <input v-model="branch" class="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm" />
          </label>
        </div>
        <div class="mt-3 max-h-32 overflow-auto rounded border p-2 font-mono text-[11px]">
          <div v-if="!preview?.commits.length" class="text-muted-foreground">Nothing to push</div>
          <div v-for="c in preview?.commits ?? []" :key="c">{{ c }}</div>
        </div>
        <label class="mt-3 flex items-center gap-2 text-xs"><input v-model="setUpstream" type="checkbox" /> Set upstream</label>
        <label class="mt-1 flex items-center gap-2 text-xs"><input v-model="forceWithLease" type="checkbox" /> Force with lease (blocked on protected)</label>
        <label class="mt-1 block text-[11px] text-muted-foreground">Push tags
          <Select v-model="pushTags">
            <SelectTrigger class="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="current">Current Branch</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </template>

      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(false)">Cancel</Button>
        <Button size="sm" :disabled="sync.pushing" @click="ok">Push</Button>
      </div>
    </div>
  </div>
</template>
