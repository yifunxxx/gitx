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

const remote = ref("origin");
const refspec = ref("");
const reviewName = ref("");
const normalizedRef = computed(() =>
  /^\d+$/.test(refspec.value.trim())
    ? `refs/pull/${refspec.value.trim()}/head`
    : refspec.value.trim(),
);
const resolvedName = computed(
  () =>
    reviewName.value.trim() ||
    refspec.value.trim().match(/(?:pull|merge-requests)\/(\d+)/)?.[1] ||
    refspec.value.trim().split("/").pop() ||
    "review",
);
const {
  location,
  loading: locating,
  error: locationError,
  edit,
} = useWorktreeLocation(
  repoPath ?? "",
  computed(() => `review-${resolvedName.value}`),
);
const busy = ref(false);
const error = ref<string | null>(null);

async function submit() {
  if (
    busy.value ||
    locating.value ||
    !normalizedRef.value ||
    !location.value.trim() ||
    workspace.repoPath !== repoPath
  )
    return;
  busy.value = true;
  error.value = null;
  try {
    const result = await store.openRef({
      worktreePath: location.value.trim(),
      remote: remote.value.trim() || "origin",
      refspec: normalizedRef.value,
      reviewName: resolvedName.value,
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
      aria-labelledby="worktree-ref-title"
      @submit.prevent="submit"
    >
      <h2 id="worktree-ref-title" class="mb-1 text-sm font-medium">
        {{ t("worktrees.openRefTitle") }}
      </h2>
      <p class="mb-3 text-[11px] text-muted-foreground">{{ t("worktrees.openRefHint") }}</p>
      <fieldset :disabled="busy">
        <label class="mb-2 block text-xs">
          <span class="text-muted-foreground">{{ t("worktrees.remote") }}</span>
          <input v-model="remote" class="mt-1 w-full rounded border bg-background px-2 py-1" />
        </label>
        <label class="mb-2 block text-xs">
          <span class="text-muted-foreground">{{ t("worktrees.refOrPr") }}</span>
          <input
            v-model="refspec"
            autofocus
            class="mt-1 w-full rounded border bg-background px-2 py-1 font-mono"
            placeholder="12  or  refs/pull/12/head"
          />
        </label>
        <label class="mb-2 block text-xs">
          <span class="text-muted-foreground">{{ t("worktrees.reviewName") }}</span>
          <input
            v-model="reviewName"
            :placeholder="resolvedName"
            class="mt-1 w-full rounded border bg-background px-2 py-1"
          />
        </label>
        <label class="mb-3 block text-xs">
          <span class="text-muted-foreground">{{ t("worktrees.location") }}</span>
          <input
            v-model="location"
            @input="edit"
            class="mt-1 w-full rounded border bg-background px-2 py-1 font-mono"
          />
        </label>
      </fieldset>
      <div v-if="error || locationError" role="alert" class="mb-2 text-xs text-destructive">
        {{ error || locationError }}
      </div>
      <div class="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" :disabled="busy" @click="close">{{
          t("common.cancel")
        }}</Button>
        <Button
          type="submit"
          size="sm"
          :disabled="busy || locating || !normalizedRef || !location.trim()"
          >{{ t("worktrees.create") }}</Button
        >
      </div>
    </form>
  </div>
</template>
