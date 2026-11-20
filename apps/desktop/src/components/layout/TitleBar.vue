<script setup lang="ts">
import {
  Check,
  ChevronDown,
  CloudDownload,
  FolderOpen,
  LoaderCircle,
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
import { Tip } from "@/components/ui/tooltip";
import WindowControls from "./WindowControls.vue";
import { useLayoutStore } from "@/stores/layoutStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { runAction } from "@/actions";
import type { ActionContext } from "@/actions";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSyncStore } from "@/stores/syncStore";
import { useWorkspaceOpen } from "@/composables/useWorkspaceOpen";
import { useUpdateStore } from "@/stores/updateStore";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import RecentProjectsMenuItems from "./RecentProjectsMenuItems.vue";

const { t } = useI18n();
const layout = useLayoutStore();
const workspace = useWorkspaceStore();
const branches = useBranchesStore();
const settings = useSettingsStore();
const sync = useSyncStore();
const updates = useUpdateStore();
const { pending: opening, pendingPath } = useWorkspaceOpen();
const projectMenuOpen = ref(false);
const projectAnchor = ref({ x: 48, y: 40 });
watch(
  () => workspace.navigationToken(),
  () => {
    projectMenuOpen.value = false;
  },
);
function openProjectMenu(event: MouseEvent) {
  if (opening.value) return;
  if (event.currentTarget instanceof HTMLElement) {
    const rect = event.currentTarget.getBoundingClientRect();
    projectAnchor.value = { x: rect.left, y: rect.bottom + 4 };
  }
  projectMenuOpen.value = !projectMenuOpen.value;
}

const ctx = computed<ActionContext>(() => ({
  repoIds: workspace.toplevel ? [workspace.toplevel] : [],
  selection: {},
  source: "toolbar",
  place: "MainToolbar",
  folderPath: workspace.folderPath,
}));

const branchLabel = computed(() => {
  if (branches.checkingOut) return `${t("operations.checkout")} · ${branches.checkoutTargetName ?? "…"}`;
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
  if (!b) return t("toolbar.branches");
  const up = b.upstream ? `${t("status.upstream")}: ${b.upstream}` : t("status.noUpstream");
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

async function run(id: string, source: ActionContext["source"] = "toolbar") {
  await runAction(id, { ...ctx.value, source, place: source });
}
</script>

<template>
  <header
    class="flex h-10 shrink-0 items-center gap-1 border-b bg-dbx-chrome px-2"
    data-tauri-drag-region
  >
    <Tip :text="t('toolbar.menu')">
      <Button
        variant="ghost"
        size="icon"
        class="shrink-0"
        :aria-label="t('toolbar.menu')"
        @click="layout.vcsPopupOpen = true"
      >
        <Menu class="h-4 w-4" />
      </Button>
    </Tip>

    <Tip :text="t('toolbar.recentProjects')">
      <Button
        variant="ghost"
        size="sm"
        class="gap-1.5"
        :disabled="opening"
        :aria-busy="opening"
        :aria-label="t('toolbar.recentProjects')"
        aria-haspopup="menu"
        :aria-expanded="projectMenuOpen"
        @click="openProjectMenu"
      >
        <LoaderCircle v-if="opening" class="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
        <FolderOpen v-else class="h-3.5 w-3.5" />
        <span class="max-w-[160px] truncate">
          {{
            opening
              ? `${t("common.loading")}${pendingPath ? ` ${pendingPath.split(/[\\/]/).pop()}` : ""}`
              : workspace.folderPath
                ? workspace.folderPath.split(/[\\/]/).pop()
                : t("welcome.openFolder")
          }}
        </span>
        <ChevronDown class="h-3 w-3 shrink-0 text-muted-foreground" />
      </Button>
    </Tip>

    <Tip :text="branchTitle" side="bottom">
      <button
        type="button"
        class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-hover-surface hover:text-foreground hover:shadow-sm disabled:opacity-50"
        :disabled="!workspace.isRepo"
        @click="branches.openPopup()"
      >
        <LoaderCircle v-if="branches.checkingOut" class="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
        <GitBranch v-else class="h-3.5 w-3.5" />
        <span>{{ branchLabel }}</span>
      </button>
    </Tip>

    <div class="flex-1" data-tauri-drag-region />

    <div class="flex items-center gap-0.5">
      <Tip v-if="updates.updateAvailable" :text="updates.toolbarTooltip" side="bottom">
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-full bg-foreground px-2.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
          data-testid="toolbar-update-button"
          :aria-label="updates.toolbarTooltip"
          @click="updates.openUpdateCenter()"
        >
          <CloudDownload class="h-3.5 w-3.5" />
          <span>{{ t("updates.toolbarLabel") }}</span>
        </button>
      </Tip>
      <Tip :text="t('toolbar.updateProject')">
        <Button
          variant="ghost"
          size="sm"
          :disabled="!workspace.isRepo || sync.updating"
          :aria-label="t('toolbar.updateProject')"
          @click="run('Vcs.UpdateProject')"
        >
          <RotateCcw class="h-3.5 w-3.5" :class="{ 'animate-spin': sync.updating }" />
        </Button>
      </Tip>
      <Tip :text="t('toolbar.commit')">
        <Button
          variant="ghost"
          size="sm"
          :aria-label="t('toolbar.commit')"
          @click="run('CheckinProject')"
        >
          <Check class="h-3.5 w-3.5" />
        </Button>
      </Tip>
      <Tip :text="t('toolbar.push')">
        <Button
          variant="ghost"
          size="sm"
          :disabled="!workspace.isRepo"
          :aria-label="t('toolbar.push')"
          @click="run('Git.Push')"
        >
          <Upload class="h-3.5 w-3.5" />
        </Button>
      </Tip>
      <Tip :text="t('toolbar.showLog')">
        <Button
          variant="ghost"
          size="sm"
          :aria-label="t('toolbar.showLog')"
          @click="
            layout.bottomOpen = true;
            layout.activeBottomTab = 'log';
          "
        >
          <History class="h-3.5 w-3.5" />
        </Button>
      </Tip>
      <Tip :text="isDark ? t('toolbar.themeLight') : t('toolbar.themeDark')">
        <Button
          variant="ghost"
          size="icon"
          :aria-label="isDark ? t('toolbar.themeLight') : t('toolbar.themeDark')"
          @click="settings.toggleTheme()"
        >
          <Sun v-if="isDark" class="h-3.5 w-3.5" />
          <Moon v-else class="h-3.5 w-3.5" />
        </Button>
      </Tip>
      <Tip :text="t('toolbar.findAction')">
        <Button
          variant="ghost"
          size="icon"
          :aria-label="t('toolbar.findAction')"
          @click="layout.findActionOpen = true"
        >
          <Search class="h-3.5 w-3.5" />
        </Button>
      </Tip>
      <Tip :text="t('toolbar.settings')">
        <Button
          variant="ghost"
          size="icon"
          :aria-label="t('toolbar.settings')"
          @click="run('Settings')"
        >
          <Settings class="h-3.5 w-3.5" />
        </Button>
      </Tip>
    </div>

    <WindowControls />
  </header>
  <ContextMenuSurface
    :label="t('toolbar.recentProjects')"
    :open="projectMenuOpen"
    :anchor-x="projectAnchor.x"
    :anchor-y="projectAnchor.y"
    :width="360"
    :estimated-height="Math.min(20, workspace.recent.length) * 48 + 80"
    @close="projectMenuOpen = false"
  >
    <RecentProjectsMenuItems @close="projectMenuOpen = false" />
  </ContextMenuSurface>
</template>
