<script setup lang="ts">
import { ref } from "vue";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";
import { useSyncStore } from "@/stores/syncStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { UpdateMethod } from "@/lib/backend";

const sync = useSyncStore();
const settings = useSettingsStore();

const strategy = ref<UpdateMethod>(settings.settings?.git?.updateMethod ?? "merge");
const dontShow = ref(false);

async function ok() {
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
  await sync.updateProject(strategy.value);
  closeDialog(true);
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">Update Project</h2>
      <div class="mt-3 space-y-2 text-xs">
        <label class="flex items-center gap-2"><input v-model="strategy" type="radio" value="merge" /> Merge</label>
        <label class="flex items-center gap-2"><input v-model="strategy" type="radio" value="rebase" /> Rebase</label>
        <label class="flex items-center gap-2">
          <input v-model="strategy" type="radio" value="reset" /> Reset to the Remote Branch
          <span class="text-warning">⚠ discards local commits not on remote</span>
        </label>
      </div>
      <label class="mt-3 flex items-center gap-2 text-xs">
        <input v-model="dontShow" type="checkbox" /> Don't show again
      </label>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(false)">Cancel</Button>
        <Button size="sm" :disabled="sync.updating" @click="ok">Update</Button>
      </div>
    </div>
  </div>
</template>
