<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { closeDialog } from "@/composables/useDialog";
import { useBranchesStore } from "@/stores/branchesStore";
import { useSyncStore } from "@/stores/syncStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const branches = useBranchesStore();
const sync = useSyncStore();
const workspace = useWorkspaceStore();

const remote = ref("origin");
const branch = ref("main");
const rebase = ref(false);
const ffOnly = ref(false);
const noFf = ref(false);
const squash = ref(false);
const noCommit = ref(false);
const noVerify = ref(false);

const preview = computed(() => {
  const opts: string[] = ["pull", "--progress", "--no-edit"];
  if (rebase.value) opts.push("--rebase");
  if (ffOnly.value) opts.push("--ff-only");
  if (noFf.value) opts.push("--no-ff");
  if (squash.value) opts.push("--squash");
  if (noCommit.value) opts.push("--no-commit");
  if (noVerify.value) opts.push("--no-verify");
  opts.push(remote.value, branch.value);
  return `git ${opts.join(" ")}`;
});

onMounted(async () => {
  await branches.refresh();
  remote.value = branches.remotes[0]?.name ?? "origin";
  const up = workspace.branch?.upstream;
  if (up?.includes("/")) {
    const [r, ...rest] = up.split("/");
    remote.value = r ?? remote.value;
    branch.value = rest.join("/") || branch.value;
  } else {
    branch.value = workspace.branch?.head ?? "main";
  }
});

async function ok() {
  try {
    await sync.pull({
      remote: remote.value,
      branch: branch.value,
      rebase: rebase.value,
      ffOnly: ffOnly.value,
      noFf: noFf.value,
      squash: squash.value,
      noCommit: noCommit.value,
      noVerify: noVerify.value,
    });
    closeDialog(true);
  } catch {
    // Error toast from syncStore; keep dialog open.
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">Pull</h2>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <label class="text-[11px] text-muted-foreground">Remote
          <Select v-model="remote" class="mt-1">
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
      <div class="mt-3 text-[11px] font-medium text-muted-foreground">Modify options</div>
      <div class="mt-1 grid grid-cols-2 gap-1 text-xs">
        <label class="flex items-center gap-2"><input v-model="rebase" type="checkbox" :disabled="ffOnly || squash" /> --rebase</label>
        <label class="flex items-center gap-2"><input v-model="ffOnly" type="checkbox" :disabled="rebase || noFf" /> --ff-only</label>
        <label class="flex items-center gap-2"><input v-model="noFf" type="checkbox" :disabled="ffOnly" /> --no-ff</label>
        <label class="flex items-center gap-2"><input v-model="squash" type="checkbox" :disabled="rebase" /> --squash</label>
        <label class="flex items-center gap-2"><input v-model="noCommit" type="checkbox" /> --no-commit</label>
        <label class="flex items-center gap-2"><input v-model="noVerify" type="checkbox" /> --no-verify</label>
      </div>
      <div class="mt-3 rounded bg-muted px-2 py-1 font-mono text-[11px]">{{ preview }}</div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(false)">Cancel</Button>
        <Button size="sm" @click="ok">Pull</Button>
      </div>
    </div>
  </div>
</template>
