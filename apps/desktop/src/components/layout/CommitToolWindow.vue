<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Plus, Minus, RefreshCw, FileDiff, ListPlus, Eye, MoreVertical } from "@lucide/vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import Skeleton from "@/components/common/Skeleton.vue";
import { Button } from "@/components/ui/button";
import ChangesTree from "@/features/commit/ChangesTree.vue";
import CommitMessageEditor from "@/features/commit/CommitMessageEditor.vue";
import RepoStateBanner from "@/features/merge/RepoStateBanner.vue";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore, type ChangesSection } from "@/stores/changesStore";
import { useDiffStore } from "@/stores/diffStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useStashShelfStore } from "@/stores/stashShelfStore";
import { useFileViewerStore } from "@/stores/fileViewerStore";
import { toast } from "@/composables/useToast";
import { getBackend } from "@/lib/backend";

const { t } = useI18n();
const workspace = useWorkspaceStore();
const changes = useChangesStore();
const diffs = useDiffStore();
const layout = useLayoutStore();
const rewrite = useRewriteStore();
const stashShelf = useStashShelfStore();
const files = useFileViewerStore();

const commitTwModeLabel = computed(() => {
  switch (layout.commitTwMode) {
    case "window":
      return t("commitTw.window");
    case "float":
      return t("commitTw.float");
    default:
      return t("commitTw.docked");
  }
});

const showMessageEditor = computed(() => !layout.commitControlsHidden);

function cycleCommitTwMode() {
  const order = ["docked", "window", "float"] as const;
  const idx = order.indexOf(layout.commitTwMode);
  void layout.setCommitTwMode(order[(idx + 1) % order.length]!);
}

function onCommitMenu() {
  const choice = window.prompt(
    "Commit TW: docked | window | float | toggle-controls",
    layout.commitTwMode,
  );
  if (!choice) return;
  const v = choice.trim().toLowerCase();
  if (v === "docked" || v === "window" || v === "float") {
    void layout.setCommitTwMode(v);
  } else if (v === "toggle-controls" || v === "toggle") {
    layout.toggleCommitControls();
  }
}

onMounted(() => {
  if (workspace.isRepo) {
    void changes.refresh();
    void rewrite.refreshOpState();
  }
});

watch(
  () => workspace.repoPath,
  () => {
    if (workspace.isRepo) {
      void changes.refresh();
      void rewrite.refreshOpState();
    }
  },
);

async function enableVcs() {
  await workspace.enableVcs("main");
  toast({ title: "Git enabled", description: "Repository initialized" });
  await changes.refresh();
}

function openDiff(path: string, section: ChangesSection) {
  if (section === "staged") {
    void diffs.openFileDiff(path, "head", "index");
  } else {
    void diffs.openFileDiff(path, "index", "worktree");
  }
}

function openFile(path: string) {
  void files.open(path);
}

async function stageSelected() {
  const paths = changes.selectedPaths;
  if (!paths.length) return;
  if (changes.selectedSection === "unversioned") {
    await changes.add(paths);
  } else {
    await changes.stage(paths);
  }
  toast({ title: "Staged", description: `${paths.length} path(s)` });
}

async function unstageSelected() {
  const paths = changes.selectedPaths;
  if (!paths.length) return;
  await changes.unstage(paths);
  toast({ title: "Unstaged", description: `${paths.length} path(s)` });
}

async function stageAll() {
  const paths = [
    ...changes.unstaged.map((f) => f.path),
    ...changes.unversioned.map((f) => f.path),
  ];
  if (!paths.length) return;
  await changes.stage(paths);
  toast({ title: "Staged all" });
}

async function newChangelist() {
  const name = window.prompt("New changelist name");
  if (!name?.trim()) return;
  await changes.createChangelist(name.trim(), true);
  toast({ title: "Changelist created", description: name.trim() });
}

function showDiffSelected() {
  const path = changes.selectedPaths[0];
  if (!path || !changes.selectedSection) return;
  openDiff(path, changes.selectedSection);
}

async function ignoreSelected() {
  const paths = changes.selectedPaths;
  if (!paths.length) return;
  await changes.ignore(paths);
  toast({ title: "Ignored", description: `${paths.length} path(s)` });
}

async function stopTrackingSelected() {
  const paths = changes.selectedPaths;
  if (!paths.length) return;
  const alsoIgnore = window.confirm("Also add to .gitignore?");
  await changes.rmCached(paths, alsoIgnore);
  toast({ title: "Stopped tracking", description: `${paths.length} path(s)` });
}

async function stashSelected() {
  if (!workspace.repoPath) return;
  const message = window.prompt("Stash message", "WIP");
  if (message == null) return;
  const paths = changes.selectedPaths.length ? changes.selectedPaths : undefined;
  await getBackend().stashCreate({
    path: workspace.repoPath,
    message: message || "WIP",
    includeUntracked: changes.selectedSection === "unversioned",
    paths: paths ?? null,
  });
  toast({ title: "Stashed" });
  await changes.refresh();
  await stashShelf.refresh();
  layout.bottomOpen = true;
  layout.activeBottomTab = stashShelf.combineTab ? "stashesShelves" : "stash";
}

async function shelveSelected() {
  if (!workspace.repoPath) return;
  const paths = changes.selectedPaths;
  if (!paths.length) {
    toast({ title: "Select files to shelve" });
    return;
  }
  const message = window.prompt("Shelf message", "Shelved changes");
  if (message == null) return;
  await getBackend().shelfCreate({
    path: workspace.repoPath,
    message: message || "Shelved changes",
    paths,
    keepChanges: false,
  });
  toast({ title: "Shelved", description: `${paths.length} path(s)` });
  await changes.refresh();
  await stashShelf.refresh();
  layout.bottomOpen = true;
  layout.activeBottomTab = stashShelf.combineTab ? "stashesShelves" : "shelf";
}

function onContext(payload: { path: string; section: ChangesSection; x: number; y: number }) {
  layout.vcsPopupOpen = false;
  void payload;
  const action = window.prompt(
    "Action: stage | unstage | ignore | shelve | stash | untrack",
    changes.stagingMode
      ? payload.section === "staged"
        ? "unstage"
        : "stage"
      : "ignore",
  );
  if (!action) return;
  switch (action.trim().toLowerCase()) {
    case "stage":
      void stageSelected();
      break;
    case "unstage":
      void unstageSelected();
      break;
    case "ignore":
      void ignoreSelected();
      break;
    case "shelve":
      void shelveSelected();
      break;
    case "stash":
      void stashSelected();
      break;
    case "untrack":
      void stopTrackingSelected();
      break;
    default:
      toast({ title: "Unknown action", description: action });
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-sidebar">
    <div
      class="flex h-8 items-center justify-between border-b px-2 text-xs font-medium"
      :class="{
        'ring-1 ring-primary/40': layout.commitTwMode === 'float',
        'border-l-2 border-l-primary': layout.commitTwMode === 'window',
      }"
    >
      <span>
        {{ t("toolWindows.commit") }}
        <span class="ml-1 text-[10px] font-normal text-muted-foreground">{{ commitTwModeLabel }}</span>
      </span>
      <div class="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          :title="t('commitTw.viewMode')"
          @click="cycleCommitTwMode"
        >
          <MoreVertical class="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="xs" :title="t('commitTw.toggleControls')" @click="onCommitMenu">⋮</Button>
        <Button variant="ghost" size="icon" :title="t('actions.refreshStatus')" @click="changes.refresh()">
          <RefreshCw class="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" :title="t('actions.showDiff')" @click="showDiffSelected">
          <FileDiff class="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :title="t('settings.fields.showIgnoredFiles')"
          @click="changes.toggleShowIgnored()"
        >
          <Eye class="h-3.5 w-3.5" />
        </Button>
        <template v-if="changes.stagingMode">
          <Button variant="ghost" size="icon" :title="t('actions.stage')" @click="stageSelected">
            <Plus class="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" :title="t('actions.unstage')" @click="unstageSelected">
            <Minus class="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="xs" @click="stageAll">{{ t("actions.stage") }} All</Button>
        </template>
        <template v-else>
          <Button variant="ghost" size="icon" :title="t('changelist.new')" @click="newChangelist">
            <ListPlus class="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="xs" @click="newChangelist">{{ t("changelist.new") }}</Button>
        </template>
      </div>
    </div>

    <EmptyState
      v-if="!workspace.folderPath"
      :title="t('empty.noFolderTitle')"
      :description="t('empty.noFolderHint')"
    />
    <EmptyState
      v-else-if="!workspace.isRepo"
      :title="t('empty.notVcs')"
      :description="t('empty.notVcsHint')"
    >
      <Button size="sm" @click="enableVcs">{{ t("empty.enableVcs") }}</Button>
    </EmptyState>
    <ErrorState v-else-if="changes.error" :message="t('empty.statusFailed')" :title="changes.error">
      <Button size="sm" variant="outline" @click="changes.refresh()">{{ t("empty.retry") }}</Button>
    </ErrorState>
    <template v-else>
      <RepoStateBanner />
      <div v-if="changes.loading && !changes.snapshot" class="space-y-2 p-2">
        <Skeleton class="h-4 w-2/3" />
        <Skeleton class="h-4 w-1/2" />
        <Skeleton class="h-4 w-3/4" />
      </div>
      <ChangesTree v-else @open-diff="openDiff" @open-file="openFile" @context="onContext" />
      <CommitMessageEditor v-if="showMessageEditor" />
      <div
        v-else
        class="border-t px-2 py-1 text-[11px] text-muted-foreground"
      >
        Commit controls hidden — Ctrl+K / Toggle Commit Controls to show
      </div>
    </template>
  </div>
</template>
