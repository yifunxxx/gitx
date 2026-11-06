<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { Button } from "@/components/ui/button";
import { useWorktreesStore } from "@/stores/worktreesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useI18n } from "vue-i18n";
import CreateWorktreeDialog from "./CreateWorktreeDialog.vue";
import OpenRefWorktreeDialog from "./OpenRefWorktreeDialog.vue";

const { t } = useI18n();
const store = useWorktreesStore();
const workspace = useWorkspaceStore();

store.userOpened = true;

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
  if (!window.confirm(t("worktrees.removeConfirm", { path: selected.value.path }))) {
    return;
  }
  const dirtyForce = window.confirm(t("worktrees.removeForceConfirm"));
  await store.remove(selected.value.path, dirtyForce);
}

async function lockSelected() {
  if (!selected.value) return;
  if (selected.value.locked) {
    await store.unlock(selected.value.path);
    return;
  }
  const reason = window.prompt(t("worktrees.lockReason"), "") ?? undefined;
  await store.lock(selected.value.path, reason || undefined);
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
      <Button size="xs" variant="ghost" @click="store.createOpen = true">
        {{ t("worktrees.new") }}
      </Button>
      <Button size="xs" variant="ghost" @click="store.openRefOpen = true">
        {{ t("worktrees.openRef") }}
      </Button>
      <Button size="xs" variant="ghost" @click="store.prune()">{{ t("worktrees.prune") }}</Button>
      <Button size="xs" variant="ghost" @click="store.refresh()">{{ t("actions.refreshStatus") }}</Button>
    </div>

    <div v-if="store.error" class="px-2 py-1 text-destructive">{{ store.error }}</div>
    <div
      v-else-if="store.loading && !store.items.length"
      class="p-2 text-muted-foreground"
    >
      Loading…
    </div>
    <div
      v-else-if="store.items.length <= 1"
      class="p-3 text-muted-foreground"
    >
      {{ t("worktrees.empty") }}
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <div
        v-for="w in store.items"
        :key="w.path"
        class="flex cursor-default items-center gap-2 border-b border-border/40 px-2 py-1.5 hover:bg-accent/50"
        :class="store.selectedPath === w.path ? 'bg-accent' : ''"
        @click="store.selectedPath = w.path"
        @dblclick="store.openWorktree(w.path, true)"
      >
        <span class="w-16 shrink-0 text-muted-foreground">
          <template v-if="w.isMain">main</template>
          <template v-else-if="w.isCurrent">current</template>
        </span>
        <span class="min-w-0 flex-1 truncate font-mono" :title="w.path">{{ w.path }}</span>
        <span class="w-28 truncate">
          {{ w.detached ? `detached ${shortHead(w.head)}` : w.branch ?? shortHead(w.head) }}
        </span>
        <span v-if="w.locked" class="text-amber-600" :title="w.lockReason ?? ''">🔒</span>
        <span v-if="w.prunable" class="text-destructive" :title="w.pruneReason ?? ''">⚠</span>
      </div>
    </div>

    <div class="flex h-8 items-center gap-1 border-t px-2">
      <Button
        size="xs"
        variant="ghost"
        :disabled="!selected"
        @click="selected && store.openWorktree(selected.path, true)"
      >
        {{ t("worktrees.open") }}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        :disabled="!selected"
        @click="selected && store.openWorktree(selected.path, false)"
      >
        {{ t("worktrees.openHere") }}
      </Button>
      <Button size="xs" variant="ghost" :disabled="!selected" @click="lockSelected">
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
    </div>

    <CreateWorktreeDialog v-if="store.createOpen" @close="store.createOpen = false" />
    <OpenRefWorktreeDialog v-if="store.openRefOpen" @close="store.openRefOpen = false" />
  </div>
</template>
