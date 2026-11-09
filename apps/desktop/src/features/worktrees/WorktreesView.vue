<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { Button } from "@/components/ui/button";
import { useWorktreesStore } from "@/stores/worktreesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useI18n } from "vue-i18n";
import CreateWorktreeDialog from "./CreateWorktreeDialog.vue";
import OpenRefWorktreeDialog from "./OpenRefWorktreeDialog.vue";
import { confirmDialog, promptDialog } from "@/composables/useConfirm";
import { openDialog } from "@/composables/useDialog";

const { t } = useI18n();
const store = useWorktreesStore();
const workspace = useWorkspaceStore();

store.userOpened = true;
watch(
  () => store.createOpen,
  async (open) => {
    if (!open) return;
    await openDialog(CreateWorktreeDialog);
    store.createOpen = false;
  },
  { immediate: true },
);
watch(
  () => store.openRefOpen,
  async (open) => {
    if (!open) return;
    await openDialog(OpenRefWorktreeDialog);
    store.openRefOpen = false;
  },
  { immediate: true },
);

const selected = computed(() => store.items.find((w) => w.path === store.selectedPath) ?? null);
const canRemove = computed(() => {
  if (!selected.value) return false;
  if (selected.value.isMain || selected.value.isCurrent || selected.value.locked) return false;
  return true;
});

onMounted(() => {
  if (workspace.isRepo) void store.refresh();
});

watch(
  () => workspace.repoPath,
  () => {
    if (workspace.isRepo) void store.refresh();
  },
);

async function removeSelected() {
  if (!selected.value || !canRemove.value) return;
  const target = selected.value;
  const repository = store.repositoryToken();
  const ok = await confirmDialog({
    title: t("worktrees.remove"),
    message: t("worktrees.removeConfirm", { path: target.path }),
    destructive: true,
  });
  if (
    !ok ||
    repository !== store.repositoryToken() ||
    !store.items.some((w) => w.path === target.path)
  )
    return;
  await store.remove(target.path, false);
}

async function lockSelected() {
  if (!selected.value) return;
  const target = selected.value;
  const repository = store.repositoryToken();
  if (selected.value.locked) {
    await store.unlock(selected.value.path);
    return;
  }
  const reason = await promptDialog({
    title: t("worktrees.lock"),
    placeholder: t("worktrees.lockReason"),
  });
  if (
    reason == null ||
    repository !== store.repositoryToken() ||
    !store.items.some((w) => w.path === target.path)
  )
    return;
  await store.lock(target.path, reason || undefined);
}

function shortHead(sha: string) {
  return sha.slice(0, 7);
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col text-xs">
    <div class="flex h-8 items-center gap-1 border-b px-2">
      <span class="font-medium">{{ t("toolWindows.worktrees") }}</span>
      <div class="flex-1" />
      <Button size="xs" variant="ghost" :disabled="store.busy" @click="store.createOpen = true">
        {{ t("worktrees.new") }}
      </Button>
      <Button size="xs" variant="ghost" :disabled="store.busy" @click="store.openRefOpen = true">
        {{ t("worktrees.openRef") }}
      </Button>
      <Button size="xs" variant="ghost" :disabled="store.busy" @click="store.prune()">{{
        t("worktrees.prune")
      }}</Button>
      <Button
        size="xs"
        variant="ghost"
        :disabled="store.busy || store.loading"
        @click="store.refresh()"
        >{{ t("actions.refreshStatus") }}</Button
      >
    </div>

    <div v-if="store.error" class="px-2 py-1 text-destructive">{{ store.error }}</div>
    <div v-else-if="store.loading && !store.items.length" class="p-2 text-muted-foreground">
      {{ t("common.loading") }}
    </div>
    <div v-else-if="store.items.length <= 1" class="p-3 text-muted-foreground">
      {{ t("worktrees.empty") }}
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <button
        v-for="w in store.items"
        :key="w.path"
        type="button"
        :aria-pressed="store.selectedPath === w.path"
        class="flex w-full cursor-pointer items-center gap-2 border-b border-border/40 px-2 py-1.5 text-left hover:bg-accent/50 focus-visible:outline focus-visible:outline-ring"
        :class="store.selectedPath === w.path ? 'bg-accent' : ''"
        @click="store.selectedPath = w.path"
        @dblclick="store.openWorktree(w.path, true)"
      >
        <span class="w-16 shrink-0 text-muted-foreground">
          <template v-if="w.isCurrent">{{ t("worktrees.current") }}</template>
          <template v-else-if="w.isMain">{{ t("worktrees.main") }}</template>
        </span>
        <span class="min-w-0 flex-1 truncate font-mono" :title="w.path">{{ w.path }}</span>
        <span class="w-28 truncate">
          {{ w.detached ? `detached ${shortHead(w.head)}` : (w.branch ?? shortHead(w.head)) }}
        </span>
        <span v-if="w.locked" class="text-amber-600" :title="w.lockReason ?? ''">🔒</span>
        <span v-if="w.prunable" class="text-destructive" :title="w.pruneReason ?? ''">⚠</span>
      </button>
    </div>

    <fieldset :disabled="store.busy" class="flex h-8 items-center gap-1 border-t px-2">
      <Button
        size="xs"
        variant="ghost"
        :disabled="!selected"
        @click="selected && store.openWorktree(selected.path, false)"
      >
        {{ t("worktrees.openHere") }}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        :disabled="!selected || selected.isMain"
        @click="lockSelected"
      >
        {{ selected?.locked ? t("worktrees.unlock") : t("worktrees.lock") }}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        class="text-destructive"
        :disabled="!canRemove"
        :title="
          selected?.isMain || selected?.isCurrent
            ? t('worktrees.cannotRemoveCurrent')
            : selected?.locked
              ? t('worktrees.cannotRemoveLocked')
              : ''
        "
        @click="removeSelected"
      >
        {{ t("worktrees.remove") }}
      </Button>
    </fieldset>
  </div>
</template>
