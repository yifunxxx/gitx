<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorktreesStore } from "@/stores/worktreesStore";
import { useI18n } from "vue-i18n";
import { formatErrorMessage } from "@/lib/errors";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useWorktreeLocation } from "./useWorktreeLocation";

const { t } = useI18n();
const workspace = useWorkspaceStore();
const store = useWorktreesStore();
const dialogId = useDialogState().value?.id;
const repoPath = workspace.repoPath;
const close = () => closeDialog(null, dialogId);
watch(() => workspace.repoPath, close);

const startRef = ref("HEAD");
const newBranch = ref("");
const {
  location,
  loading: locating,
  error: locationError,
  edit,
} = useWorktreeLocation(
  repoPath ?? "",
  computed(() => newBranch.value.trim() || startRef.value.trim() || "HEAD"),
);
const openAfter = ref(true);
const track = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);

async function submit() {
  if (busy.value || locating.value || !location.value.trim() || workspace.repoPath !== repoPath)
    return;
  busy.value = true;
  error.value = null;
  try {
    const result = await store.create({
      worktreePath: location.value.trim(),
      startRef: startRef.value.trim() || "HEAD",
      newBranch: newBranch.value.trim() || null,
      track: !!newBranch.value.trim() && track.value,
      openAfter: openAfter.value,
    });
    if (result) close();
  } catch (e) {
    error.value = formatErrorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div
    class="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
    @keydown.esc.stop="!busy && close()"
  >
    <form
      class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="worktree-create-title"
      @submit.prevent="submit"
    >
      <h2 id="worktree-create-title" class="mb-3 text-sm font-medium">
        {{ t("worktrees.newTitle") }}
      </h2>
      <fieldset :disabled="busy">
        <label class="mb-2 block text-xs">
          <span class="text-muted-foreground">{{ t("worktrees.from") }}</span>
          <input
            v-model="startRef"
            autofocus
            class="mt-1 w-full rounded border bg-background px-2 py-1"
            placeholder="main / origin/feature / sha"
          />
        </label>
        <label class="mb-2 block text-xs">
          <span class="text-muted-foreground">{{ t("worktrees.newBranch") }}</span>
          <input
            v-model="newBranch"
            class="mt-1 w-full rounded border bg-background px-2 py-1"
            :placeholder="t('worktrees.newBranchHint')"
          />
        </label>
        <label class="mb-2 block text-xs">
          <span class="text-muted-foreground">{{ t("worktrees.location") }}</span>
          <input
            v-model="location"
            @input="edit"
            class="mt-1 w-full rounded border bg-background px-2 py-1 font-mono"
          />
        </label>
        <label v-if="newBranch.trim()" class="mb-3 flex items-center gap-2 text-xs">
          <input v-model="track" type="checkbox" />{{ t("worktrees.track") }}
        </label>
        <label class="mb-3 flex items-center gap-2 text-xs">
          <input v-model="openAfter" type="checkbox" />
          {{ t("worktrees.openAfter") }}
        </label>
      </fieldset>
      <div v-if="error || locationError" role="alert" class="mb-2 text-xs text-destructive">
        {{ error || locationError }}
      </div>
      <div class="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" :disabled="busy" @click="close">{{
          t("common.cancel")
        }}</Button>
        <Button type="submit" size="sm" :disabled="busy || locating || !location.trim()">{{
          t("worktrees.create")
        }}</Button>
      </div>
    </form>
  </div>
</template>
