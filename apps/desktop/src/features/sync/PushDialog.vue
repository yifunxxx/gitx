<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import VirtualList from "@/components/common/VirtualList.vue";
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
import { formatErrorMessage } from "@/lib/errors";

const { t } = useI18n();
const sync = useSyncStore();
const branches = useBranchesStore();
const workspace = useWorkspaceStore();
const path = workspace.repoPath;
const preview = ref<PushPreview | null>(null);
const remote = ref("");
const branch = ref(workspace.branch?.head ?? "");
const remoteBranch = ref("");
const setUpstream = ref(false);
const forceWithLease = ref(false);
const pushTags = ref<"none" | "all" | "current">("none");
const defineName = ref("origin");
const defineUrl = ref("");
const loading = ref(true);
const submitting = ref(false);
const initialized = ref(false);
const error = ref<string | null>(null);
const repositoryChanged = ref(false);
let alive = true;
let applyingDefaults = false;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const valid = () => alive && !repositoryChanged.value && workspace.repoPath === path;
const busy = computed(() => submitting.value || sync.pushing);
const canPush = computed(
  () =>
    valid() &&
    !loading.value &&
    !busy.value &&
    !error.value &&
    !!preview.value?.hasRemote &&
    !!remote.value.trim() &&
    !!branch.value.trim() &&
    !!remoteBranch.value.trim(),
);

watch(
  () => workspace.repoPath,
  () => {
    repositoryChanged.value = true;
    ++generation;
    clearTimeout(timer);
    preview.value = null;
    loading.value = false;
  },
  { flush: "sync" },
);

watch(
  [remote, branch, remoteBranch],
  () => {
    if (!initialized.value || applyingDefaults || !valid()) return;
    // Invalidate synchronously, including during debounce, so changed fields
    // can never be submitted with an old preview or an old request result.
    ++generation;
    clearTimeout(timer);
    preview.value = null;
    error.value = null;
    loading.value = true;
    timer = setTimeout(() => {
      void refreshPreview();
    }, 250);
  },
  { flush: "sync" },
);

onUnmounted(() => {
  alive = false;
  ++generation;
  clearTimeout(timer);
});

async function refreshPreview(defaults = false) {
  if (!valid()) return;
  const request = ++generation;
  preview.value = null;
  loading.value = true;
  error.value = null;
  try {
    const result = await sync.previewPush(
      remote.value.trim() || undefined,
      branch.value.trim() || undefined,
      remoteBranch.value.trim() || undefined,
    );
    if (!valid() || request !== generation) return;
    if (!result) throw new Error(t("syncUi.noRepository"));
    applyingDefaults = true;
    try {
      if (defaults) {
        remote.value = result.remote;
        branch.value = result.refs[0]?.local ?? branch.value;
        remoteBranch.value = result.refs[0]?.remoteBranch ?? branch.value;
      }
      setUpstream.value = result.setUpstream;
      preview.value = result;
    } finally {
      applyingDefaults = false;
    }
  } catch (e) {
    if (valid() && request === generation) error.value = formatErrorMessage(e);
  } finally {
    if (valid() && request === generation) loading.value = false;
  }
}

onMounted(async () => {
  try {
    await branches.refresh();
    if (!valid()) return;
    if (branches.error) throw new Error(branches.error);
    await refreshPreview(true);
  } catch (e) {
    if (valid()) {
      error.value = formatErrorMessage(e);
      loading.value = false;
    }
  } finally {
    initialized.value = true;
  }
});

async function defineRemote() {
  if (!valid() || busy.value || !path || !defineUrl.value.trim()) return;
  submitting.value = true;
  try {
    const name = defineName.value.trim() || "origin";
    await getBackend().remoteAdd({ path, name, url: defineUrl.value.trim(), fetchAfter: false });
    if (!valid()) return;
    await branches.refresh();
    if (!valid()) return;
    applyingDefaults = true;
    remote.value = name;
    applyingDefaults = false;
    await refreshPreview(true);
  } catch (e) {
    if (valid()) error.value = formatErrorMessage(e);
  } finally {
    if (alive) submitting.value = false;
  }
}

async function ok() {
  if (!canPush.value) return;
  const opts = {
    remote: remote.value.trim(),
    branch: branch.value.trim(),
    remoteBranch: remoteBranch.value.trim(),
    setUpstream: setUpstream.value,
    forceWithLease: forceWithLease.value,
    pushTags: pushTags.value === "none" ? null : pushTags.value,
  };
  submitting.value = true;
  try {
    let result = await sync.push(opts);
    if (!valid() || !result) return;
    if (result.rejected) {
      if (workspace.branch?.head !== opts.branch) {
        toast({ title: t("syncUi.checkoutBeforeUpdate", { branch: opts.branch }) });
        return;
      }
      const choice = await openDialog<"rebase" | "merge" | null>(PushRejectedDialog, {
        message: result.message,
      });
      if (!valid() || (choice !== "rebase" && choice !== "merge")) return;
      if (workspace.branch?.head !== opts.branch) {
        toast({ title: t("syncUi.checkoutBeforeUpdate", { branch: opts.branch }) });
        return;
      }
      await sync.pull({
        remote: opts.remote,
        branch: opts.remoteBranch,
        rebase: choice === "rebase",
      });
      if (!valid()) return;
      result = await sync.push({ ...opts, forceWithLease: false });
      if (!valid() || !result || result.rejected) return;
    }
    closeDialog(true);
  } catch {
    // The sync store reports the Git error; keep this dialog available to retry.
  } finally {
    if (alive) submitting.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div
      role="dialog"
      aria-labelledby="push-title"
      class="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-auto rounded-lg border bg-popover p-4 shadow-lg"
    >
      <h2 id="push-title" class="text-sm font-semibold">{{ t("toolbar.push") }}</h2>
      <p v-if="error" role="alert" class="mt-3 text-xs text-destructive">{{ error }}</p>
      <p v-if="repositoryChanged" role="alert" class="mt-3 text-xs text-destructive">
        {{ t("syncUi.repositoryChanged") }}
      </p>
      <div v-if="preview && !preview.hasRemote" class="mt-3 rounded border border-dashed p-3">
        <div class="text-xs font-medium">{{ t("syncUi.defineRemote") }}</div>
        <div class="mt-2 flex gap-2">
          <input
            v-model="defineName"
            :disabled="busy || repositoryChanged"
            :aria-label="t('syncUi.remoteName')"
            class="h-8 w-24 rounded-md border bg-background px-2 text-sm"
          />
          <input
            v-model="defineUrl"
            :disabled="busy || repositoryChanged"
            aria-label="URL"
            class="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-sm"
            placeholder="URL"
          />
        </div>
        <Button
          class="mt-2"
          size="xs"
          :disabled="busy || repositoryChanged || !defineUrl.trim()"
          @click="defineRemote"
          >{{ t("syncUi.addAndUse") }}</Button
        >
      </div>
      <fieldset :disabled="busy || repositoryChanged || !initialized" class="min-w-0">
        <div class="mt-3 grid grid-cols-2 gap-2">
          <label class="col-span-2 text-[11px] text-muted-foreground"
            >{{ t("syncUi.remote") }}
            <Select v-model="remote" :disabled="busy || repositoryChanged || !initialized">
              <SelectTrigger class="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent
                ><SelectItem v-for="r in branches.remotes" :key="r.name" :value="r.name">{{
                  r.name
                }}</SelectItem></SelectContent
              >
            </Select>
          </label>
          <label class="text-[11px] text-muted-foreground"
            >{{ t("syncUi.localBranch") }}
            <input
              v-model="branch"
              :aria-label="t('syncUi.localBranch')"
              class="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm"
            />
          </label>
          <label class="text-[11px] text-muted-foreground"
            >{{ t("syncUi.remoteBranch") }}
            <input
              v-model="remoteBranch"
              :aria-label="t('syncUi.remoteBranch')"
              class="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm"
            />
          </label>
        </div>
        <div
          class="mt-3 flex h-32 flex-col overflow-hidden rounded border p-2 font-mono text-[11px]"
          :aria-busy="loading"
        >
          <p v-if="loading" role="status" class="text-muted-foreground">{{ t("common.loading") }}</p>
          <template v-else-if="preview">
            <div v-if="!preview.commits.length" class="text-muted-foreground">
              {{ t("syncUi.noOutgoingCommits") }}
            </div>
            <VirtualList
              v-else
              :items="preview.commits"
              :item-height="22"
              :get-key="(_c, index) => index"
            >
              <template #default="{ item: c }"
                ><div class="flex h-full min-w-0 items-center" :title="c">
                  <span class="truncate">{{ c }}</span>
                </div></template
              >
            </VirtualList>
            <div v-if="preview.commitsTruncated" class="mt-1 shrink-0 text-muted-foreground">
              {{ t("syncUi.previewTruncated") }}
            </div>
          </template>
        </div>
        <p class="mt-2 text-[11px] text-muted-foreground">{{ t("syncUi.previewHint") }}</p>
        <label class="mt-3 flex items-center gap-2 text-xs"
          ><input v-model="setUpstream" type="checkbox" />{{ t("syncUi.setUpstream") }}</label
        >
        <label class="mt-1 flex items-center gap-2 text-xs"
          ><input v-model="forceWithLease" type="checkbox" />{{ t("syncUi.forceWithLease") }}</label
        >
        <label class="mt-2 block text-[11px] text-muted-foreground"
          >{{ t("syncUi.pushTags") }}
          <Select v-model="pushTags" :disabled="busy || repositoryChanged">
            <SelectTrigger class="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{{ t("syncUi.tagsNone") }}</SelectItem>
              <SelectItem value="current">{{ t("syncUi.tagsReachable") }}</SelectItem>
              <SelectItem value="all">{{ t("syncUi.tagsAll") }}</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </fieldset>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(false)">{{
          t("common.cancel")
        }}</Button>
        <Button size="sm" :disabled="!canPush" @click="ok">{{ t("toolbar.push") }}</Button>
      </div>
    </div>
  </div>
</template>
