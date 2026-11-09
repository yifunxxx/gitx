<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
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
import { formatErrorMessage } from "@/lib/errors";
import { useI18n } from "vue-i18n";

const branches = useBranchesStore();
const sync = useSyncStore();
const workspace = useWorkspaceStore();
const { t } = useI18n();

const path = workspace.repoPath;
const upstream = workspace.branch?.upstream;
const upstreamSplit = upstream?.indexOf("/") ?? -1;
const remote = ref(upstreamSplit > 0 ? upstream!.slice(0, upstreamSplit) : "origin");
const branch = ref(
  upstreamSplit > 0 ? upstream!.slice(upstreamSplit + 1) : (workspace.branch?.head ?? ""),
);
const loading = ref(true);
const error = ref<string | null>(null);
const repositoryChanged = ref(false);
let alive = true;
watch(
  () => workspace.repoPath,
  () => {
    repositoryChanged.value = true;
  },
  { flush: "sync" },
);
onUnmounted(() => {
  alive = false;
});
const canPull = computed(
  () =>
    !loading.value &&
    !sync.pulling &&
    !repositoryChanged.value &&
    !error.value &&
    !!remote.value.trim() &&
    !!branch.value.trim(),
);
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
  try {
    await branches.refresh();
    if (!alive || repositoryChanged.value || workspace.repoPath !== path) return;
    if (branches.error) throw new Error(branches.error);
    if (!branches.remotes.some((r) => r.name === remote.value))
      remote.value = branches.remotes[0]?.name ?? "";
  } catch (e) {
    if (alive) error.value = formatErrorMessage(e);
  } finally {
    if (alive) loading.value = false;
  }
});

async function ok() {
  if (!canPull.value) return;
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
    if (alive) closeDialog(true);
  } catch {
    // Error toast from syncStore; keep dialog open.
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div
      role="dialog"
      aria-labelledby="pull-title"
      class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg"
    >
      <h2 id="pull-title" class="text-sm font-semibold">Pull</h2>
      <p v-if="loading" role="status" class="mt-2 text-xs text-muted-foreground">
        {{ t("common.loading") }}
      </p>
      <p v-if="error" role="alert" class="mt-2 text-xs text-destructive">{{ error }}</p>
      <p v-if="repositoryChanged" role="alert" class="mt-2 text-xs text-destructive">
        {{ t("syncUi.repositoryChanged") }}
      </p>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <label class="text-[11px] text-muted-foreground"
          >{{ t("syncUi.remote") }}
          <Select
            v-model="remote"
            class="mt-1"
            :disabled="loading || sync.pulling || repositoryChanged"
          >
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
        <label class="text-[11px] text-muted-foreground"
          >{{ t("syncUi.branch") }}
          <input
            v-model="branch"
            :disabled="loading || sync.pulling || repositoryChanged"
            class="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm"
          />
        </label>
      </div>
      <div class="mt-3 text-[11px] font-medium text-muted-foreground">
        {{ t("syncUi.options") }}
      </div>
      <div class="mt-1 grid grid-cols-2 gap-1 text-xs">
        <label class="flex items-center gap-2"
          ><input v-model="rebase" type="checkbox" :disabled="ffOnly || squash" /> --rebase</label
        >
        <label class="flex items-center gap-2"
          ><input v-model="ffOnly" type="checkbox" :disabled="rebase || noFf" /> --ff-only</label
        >
        <label class="flex items-center gap-2"
          ><input v-model="noFf" type="checkbox" :disabled="ffOnly || squash" /> --no-ff</label
        >
        <label class="flex items-center gap-2"
          ><input v-model="squash" type="checkbox" :disabled="rebase || noFf" /> --squash</label
        >
        <label class="flex items-center gap-2"
          ><input v-model="noCommit" type="checkbox" /> --no-commit</label
        >
        <label class="flex items-center gap-2"
          ><input v-model="noVerify" type="checkbox" /> --no-verify</label
        >
      </div>
      <div class="mt-3 rounded bg-muted px-2 py-1 font-mono text-[11px]">{{ preview }}</div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(false)">{{
          t("common.cancel")
        }}</Button>
        <Button size="sm" :disabled="!canPull" @click="ok">Pull</Button>
      </div>
    </div>
  </div>
</template>
