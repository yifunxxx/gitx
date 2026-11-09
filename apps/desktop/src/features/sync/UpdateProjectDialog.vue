<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useSyncStore } from "@/stores/syncStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { UpdateMethod } from "@/lib/backend";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { formatErrorMessage } from "@/lib/errors";
import { useI18n } from "vue-i18n";

const sync = useSyncStore();
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const dialog = useDialogState();
const dialogId = dialog.value?.id;
const path = workspace.repoPath;
const navigation = workspace.navigationToken();
const { t } = useI18n();
const working = ref(false);
const error = ref<string | null>(null);
let alive = true;
onUnmounted(() => {
  alive = false;
});
const current = () =>
  alive &&
  !!path &&
  workspace.repoPath === path &&
  workspace.navigationToken() === navigation &&
  dialog.value?.id === dialogId;
const busy = computed(() => working.value || sync.updating);
const stale = computed(() => !current());

const strategy = ref<UpdateMethod>(settings.settings?.git?.updateMethod ?? "merge");
const dontShow = ref(false);

async function ok() {
  if (!current() || busy.value) return;
  working.value = true;
  error.value = null;
  try {
    if (dontShow.value && settings.settings) {
      await settings.save({
        ...settings.settings,
        git: {
          ...(settings.settings.git ?? {
            updateMethod: "merge",
            fetchTags: "auto",
            autoFetchMinutes: 0,
            checkIncoming: "auto",
            showUpdateInfo: true,
            showOptionsBeforeUpdate: true,
            fetchOnAddRemote: true,
            protectedBranches: ["main", "master"],
            useCredentialHelper: true,
            groupBranchesByDirectory: true,
            showRecentBranches: true,
            showTags: true,
            cherryPickSuffixProtected: true,
          }),
          showOptionsBeforeUpdate: false,
          updateMethod: strategy.value,
        },
      });
    }
    if (!current()) return;
    await sync.updateProject(strategy.value);
    if (current()) closeDialog(true, dialogId);
  } catch (reason) {
    if (current()) error.value = formatErrorMessage(reason);
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div
      role="dialog"
      aria-modal="true"
      :aria-label="t('actions.updateProject')"
      :data-dialog-busy="busy"
      class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg"
    >
      <h2 class="text-sm font-semibold">{{ t("actions.updateProject") }}</h2>
      <p v-if="stale" role="alert" class="mt-2 text-xs text-destructive">
        {{ t("syncUi.repositoryChanged") }}
      </p>
      <p v-if="error" role="alert" class="mt-2 text-xs text-destructive">{{ error }}</p>
      <div class="mt-3 space-y-2 text-xs">
        <label class="flex items-center gap-2"
          ><input v-model="strategy" type="radio" value="merge" :disabled="busy || stale" />
          {{ t("syncUi.updateMerge") }}</label
        >
        <label class="flex items-center gap-2"
          ><input v-model="strategy" type="radio" value="rebase" :disabled="busy || stale" />
          {{ t("syncUi.updateRebase") }}</label
        >
        <label class="flex items-center gap-2">
          <input v-model="strategy" type="radio" value="reset" :disabled="busy || stale" />
          {{ t("syncUi.updateReset") }}
          <span class="text-warning">{{ t("syncUi.updateResetWarning") }}</span>
        </label>
      </div>
      <label class="mt-3 flex items-center gap-2 text-xs">
        <input v-model="dontShow" type="checkbox" :disabled="busy || stale" />
        {{ t("syncUi.updateDontShow") }}
      </label>
      <p v-if="busy" role="status" class="mt-3 text-xs text-muted-foreground">
        {{ t("syncUi.updatingProject") }}
      </p>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" :disabled="busy" @click="closeDialog(false, dialogId)">{{
          t("common.cancel")
        }}</Button>
        <Button size="sm" :disabled="busy || stale" @click="ok">
          {{ busy ? t("syncUi.updatingProject") : t("syncUi.updateAction") }}
        </Button>
      </div>
    </div>
  </div>
</template>
