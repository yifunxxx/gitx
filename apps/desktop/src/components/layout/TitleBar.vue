<script setup lang="ts">
import {
  Check,
  FolderOpen,
  GitBranch,
  History,
  Menu,
  Moon,
  RotateCcw,
  Search,
  Settings,
  Sun,
  Upload,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import WindowControls from "./WindowControls.vue";
import { useLayoutStore } from "@/stores/layoutStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { runAction } from "@/actions";
import type { ActionContext } from "@/actions";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { isTauri } from "@/lib/utils";
import { toast } from "@/composables/useToast";
import { useChangesStore } from "@/stores/changesStore";
import { useLogStore } from "@/stores/logStore";
import { useSettingsStore } from "@/stores/settingsStore";

const { t } = useI18n();
const layout = useLayoutStore();
const workspace = useWorkspaceStore();
const branches = useBranchesStore();
const changes = useChangesStore();
const log = useLogStore();
const settings = useSettingsStore();

const ctx = computed<ActionContext>(() => ({
  repoIds: workspace.toplevel ? [workspace.toplevel] : [],
  selection: {},
  source: "toolbar",
  place: "MainToolbar",
  folderPath: workspace.folderPath,
}));

const branchLabel = computed(() => {
  if (!workspace.isRepo) return "—";
  const b = workspace.branch;
  if (!b) return "…";
  if (b.detached) return `HEAD (${b.head})`;
  const ahead = b.ahead ? ` ↑${b.ahead}` : "";
  const behind = b.behind
    ? branches.hasUnfetched
      ? ` ↓${b.behind}•`
      : ` ↓${b.behind}`
    : branches.hasUnfetched
      ? " ↓•"
      : "";
  return `${b.head}${behind}${ahead}`;
});

const branchTitle = computed(() => {
  const b = workspace.branch;
  if (!b) return t("actions.branches");
  const up = b.upstream
    ? `${t("status.upstream")}: ${b.upstream}`
    : t("status.noUpstream");
  const fetched = branches.lastFetchAt
    ? `${t("status.lastFetch")}: ${new Date(branches.lastFetchAt).toLocaleTimeString()}`
    : t("status.notFetched");
  return `${up}\n${fetched}`;
});

const isDark = computed(() => {
  const theme = settings.settings?.appearance.theme ?? "system";
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
});

async function openFolder() {
  let path: string | null = null;
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    path = typeof selected === "string" ? selected : null;
  } else {
    path = window.prompt(t("welcome.folderPrompt"), workspace.folderPath ?? "/tmp") || null;
  }
  if (!path) return;
  await workspace.openFolder(path);
  toast({ title: t("welcome.opened"), description: path });
  if (workspace.isRepo) {
    await changes.refresh();
    await log.load(true);
    await branches.refresh();
    layout.activeBottomTab = "log";
  }
  await runAction("Git.RefreshStatus", { ...ctx.value, folderPath: path, source: "toolbar" });
}

async function run(id: string, source: ActionContext["source"] = "toolbar") {
  await runAction(id, { ...ctx.value, source, place: source });
}
</script>

<template>
  <header
    class="flex h-10 shrink-0 items-center gap-1 border-b bg-dbx-chrome px-2"
    data-tauri-drag-region
  >
    <Button variant="ghost" size="icon" class="shrink-0" @click="layout.vcsPopupOpen = true">
      <Menu class="h-4 w-4" />
    </Button>

    <Button variant="ghost" size="sm" class="gap-1.5" @click="openFolder">
      <FolderOpen class="h-3.5 w-3.5" />
      <span class="max-w-[160px] truncate">
        {{
          workspace.folderPath
            ? workspace.folderPath.split(/[\\/]/).pop()
            : t("welcome.openFolder")
        }}
      </span>
    </Button>

    <button
      type="button"
      class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      :title="branchTitle"
      :disabled="!workspace.isRepo"
      @click="branches.openPopup()"
    >
      <GitBranch class="h-3.5 w-3.5" />
      <span>{{ branchLabel }}</span>
    </button>

    <div class="flex-1" data-tauri-drag-region />

    <div class="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        :title="t('actions.updateProject')"
        :disabled="!workspace.isRepo"
        @click="run('Vcs.UpdateProject')"
      >
        <RotateCcw class="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" :title="t('actions.commit')" @click="run('CheckinProject')">
        <Check class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        :title="t('actions.push')"
        :disabled="!workspace.isRepo"
        @click="run('Git.Push')"
      >
        <Upload class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        :title="t('toolWindows.log')"
        @click="layout.bottomOpen = true; layout.activeBottomTab = 'log'"
      >
        <History class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        :title="isDark ? t('settings.theme.light') : t('settings.theme.dark')"
        @click="settings.toggleTheme()"
      >
        <Sun v-if="isDark" class="h-3.5 w-3.5" />
        <Moon v-else class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        :title="t('actions.findAction')"
        @click="layout.findActionOpen = true"
      >
        <Search class="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        :title="t('settings.title')"
        @click="run('Settings')"
      >
        <Settings class="h-3.5 w-3.5" />
      </Button>
    </div>

    <WindowControls />
  </header>
</template>
