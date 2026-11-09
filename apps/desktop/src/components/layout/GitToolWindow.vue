<script setup lang="ts">
import { computed } from "vue";
import { Maximize2, Minimize2 } from "@lucide/vue";
import { useLayoutStore } from "@/stores/layoutStore";
import { useConsoleStore } from "@/stores/consoleStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorktreesStore } from "@/stores/worktreesStore";
import { useI18n } from "vue-i18n";
import LogView from "@/features/log/LogView.vue";
import UpdateInfoView from "@/features/sync/UpdateInfoView.vue";
import StashShelfView from "@/features/stash/StashShelfView.vue";
import WorktreesView from "@/features/worktrees/WorktreesView.vue";

const layout = useLayoutStore();
const consoleStore = useConsoleStore();
const settings = useSettingsStore();
const worktrees = useWorktreesStore();
const { t } = useI18n();

const combineStashesShelves = computed(
  () => settings.settings?.git?.combineStashesAndShelves !== false,
);

type BottomTab = "console" | "log" | "update" | "stash" | "shelf" | "stashesShelves" | "worktrees";

const showWorktreesTab = computed(() => worktrees.userOpened || worktrees.items.length > 1);

const tabs = computed(() => {
  const base: { id: BottomTab; label: string }[] = [
    { id: "log", label: t("toolWindows.log") },
    { id: "update", label: t("toolWindows.updateInfo") },
  ];
  if (combineStashesShelves.value) {
    base.push({ id: "stashesShelves", label: t("toolWindows.stashesShelves") });
  } else {
    base.push({ id: "stash", label: t("toolWindows.stash") });
    base.push({ id: "shelf", label: t("toolWindows.shelf") });
  }
  if (showWorktreesTab.value) {
    base.push({ id: "worktrees", label: t("toolWindows.worktrees") });
  }
  base.push({ id: "console", label: t("toolWindows.console") });
  return base;
});

const lines = computed(() => consoleStore.lines);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-sidebar">
    <div class="flex h-8 items-center gap-1 border-b px-1">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="rounded px-2 py-1 text-xs"
        :class="
          layout.activeBottomTab === tab.id
            ? 'bg-background text-foreground ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent'
        "
        @click="layout.activeBottomTab = tab.id"
        @dblclick="layout.bottomMaximized = !layout.bottomMaximized"
      >
        {{ tab.label }}
      </button>
      <div class="flex-1" />
      <button
        type="button"
        class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        :title="t(layout.bottomMaximized ? 'log.restorePanel' : 'log.maximizePanel')"
        :aria-label="t(layout.bottomMaximized ? 'log.restorePanel' : 'log.maximizePanel')"
        @click="layout.bottomMaximized = !layout.bottomMaximized"
      >
        <Minimize2 v-if="layout.bottomMaximized" class="h-3.5 w-3.5" />
        <Maximize2 v-else class="h-3.5 w-3.5" />
      </button>
      <button
        v-if="layout.activeBottomTab === 'console'"
        type="button"
        class="px-2 text-[11px] text-muted-foreground hover:text-foreground"
        @click="consoleStore.clear()"
      >
        Clear
      </button>
    </div>

    <div
      v-if="layout.activeBottomTab === 'console'"
      class="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px]"
    >
      <div v-if="!lines.length" class="text-muted-foreground">
        Console is empty. Git commands appear here as you work.
      </div>
      <div
        v-for="line in lines"
        :key="line.id"
        class="whitespace-pre-wrap break-all"
        :class="{
          'text-info': line.stream === 'cmd',
          'text-foreground': line.stream === 'stdout',
          'text-destructive': line.stream === 'stderr',
        }"
      >
        <span class="mr-2 opacity-50">{{ line.stream }}</span
        >{{ line.line }}
      </div>
    </div>
    <div v-else-if="layout.activeBottomTab === 'update'" class="min-h-0 flex-1">
      <UpdateInfoView />
    </div>
    <div v-else-if="layout.activeBottomTab === 'stashesShelves'" class="min-h-0 flex-1">
      <StashShelfView mode="combined" />
    </div>
    <div v-else-if="layout.activeBottomTab === 'stash'" class="min-h-0 flex-1">
      <StashShelfView mode="stash" />
    </div>
    <div v-else-if="layout.activeBottomTab === 'shelf'" class="min-h-0 flex-1">
      <StashShelfView mode="shelf" />
    </div>
    <div v-else-if="layout.activeBottomTab === 'worktrees'" class="min-h-0 flex-1">
      <WorktreesView />
    </div>
    <div v-else class="min-h-0 flex-1">
      <LogView />
    </div>
  </div>
</template>
