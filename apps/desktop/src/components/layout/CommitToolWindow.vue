<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Plus, Minus, RefreshCw, FileDiff, ListPlus, Eye, MoreVertical } from "@lucide/vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import Skeleton from "@/components/common/Skeleton.vue";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { confirmDialog, promptDialog } from "@/composables/useConfirm";
import { getBackend } from "@/lib/backend";
import type { CommitTwMode } from "@/lib/backend";
import { clampMenuPosition } from "@/lib/contextMenu";

const { t } = useI18n();
const workspace = useWorkspaceStore();
const changes = useChangesStore();
const diffs = useDiffStore();
const layout = useLayoutStore();
const rewrite = useRewriteStore();
const stashShelf = useStashShelfStore();
const files = useFileViewerStore();

const ctxMenu = ref<{
  open: boolean;
  x: number;
  y: number;
  path: string;
  section: ChangesSection;
} | null>(null);

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

async function setMode(mode: CommitTwMode) {
  await layout.setCommitTwMode(mode);
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
  toast({ title: t("empty.enableVcs"), description: t("welcome.repoCreated") });
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
  toast({ title: t("actions.stage"), description: `${paths.length}` });
}

async function unstageSelected() {
  const paths = changes.selectedPaths;
  if (!paths.length) return;
  await changes.unstage(paths);
  toast({ title: t("actions.unstage"), description: `${paths.length}` });
}

async function stageAll() {
  const paths = [...changes.unstaged.map((f) => f.path), ...changes.unversioned.map((f) => f.path)];
  if (!paths.length) return;
  await changes.stage(paths);
  toast({ title: t("commitTw.stageAll") });
}

async function newChangelist() {
  const name = await promptDialog({
    title: t("changelist.new"),
    placeholder: t("changelist.namePlaceholder"),
    allowEmpty: false,
  });
  if (!name?.trim()) return;
  await changes.createChangelist(name.trim(), true);
  toast({ title: t("changelist.new"), description: name.trim() });
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
  toast({ title: t("commitTw.ignored"), description: `${paths.length}` });
}

async function stopTrackingSelected() {
  const paths = changes.selectedPaths;
  if (!paths.length) return;
  const alsoIgnore = await confirmDialog({
    title: t("commitTw.untrackTitle"),
    message: t("commitTw.untrackAlsoIgnore"),
  });
  await changes.rmCached(paths, alsoIgnore);
  toast({ title: t("commitTw.untracked"), description: `${paths.length}` });
}

async function stashSelected() {
  if (!workspace.repoPath) return;
  const message = await promptDialog({
    title: t("stash.create"),
    defaultValue: "WIP",
    placeholder: t("stash.messagePrompt"),
  });
  if (message == null) return;
  const paths = changes.selectedPaths.length ? changes.selectedPaths : undefined;
  await getBackend().stashCreate({
    path: workspace.repoPath,
    message: message || "WIP",
    includeUntracked: changes.selectedSection === "unversioned",
    paths: paths ?? null,
  });
  toast({ title: t("stash.create") });
  await changes.refresh();
  await stashShelf.refresh();
  layout.bottomOpen = true;
  layout.activeBottomTab = stashShelf.combineTab ? "stashesShelves" : "stash";
}

async function shelveSelected() {
  if (!workspace.repoPath) return;
  const paths = changes.selectedPaths;
  if (!paths.length) {
    toast({ title: t("shelf.selectFiles") });
    return;
  }
  const message = await promptDialog({
    title: t("shelf.create"),
    defaultValue: t("shelf.defaultMessage"),
    placeholder: t("shelf.renamePrompt"),
  });
  if (message == null) return;
  await getBackend().shelfCreate({
    path: workspace.repoPath,
    message: message || t("shelf.defaultMessage"),
    paths,
    keepChanges: false,
  });
  toast({ title: t("shelf.create"), description: `${paths.length}` });
  await changes.refresh();
  await stashShelf.refresh();
  layout.bottomOpen = true;
  layout.activeBottomTab = stashShelf.combineTab ? "stashesShelves" : "shelf";
}

function onContext(payload: { path: string; section: ChangesSection; x: number; y: number }) {
  layout.vcsPopupOpen = false;
  const pos = clampMenuPosition(payload.x, payload.y, 200, 200);
  ctxMenu.value = {
    open: true,
    x: pos.x,
    y: pos.y,
    path: payload.path,
    section: payload.section,
  };
}

function closeCtx() {
  if (ctxMenu.value) ctxMenu.value = { ...ctxMenu.value, open: false };
}

async function runCtx(action: string) {
  closeCtx();
  switch (action) {
    case "stage":
      await stageSelected();
      break;
    case "unstage":
      await unstageSelected();
      break;
    case "ignore":
      await ignoreSelected();
      break;
    case "shelve":
      await shelveSelected();
      break;
    case "stash":
      await stashSelected();
      break;
    case "untrack":
      await stopTrackingSelected();
      break;
    default:
      break;
  }
}
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col bg-sidebar"
    data-gitx-context="changes"
    :class="{
      'ring-1 ring-primary/40': layout.commitTwMode === 'float',
      'border-l-2 border-l-primary': layout.commitTwMode === 'window',
    }"
  >
    <div class="flex h-8 items-center justify-between border-b px-2 text-xs font-medium">
      <span>
        {{ t("toolWindows.commit") }}
        <span class="ml-1 text-[10px] font-normal text-muted-foreground">{{
          commitTwModeLabel
        }}</span>
      </span>
      <div class="flex items-center gap-0.5">
        <DropdownMenu>
          <Tip :text="t('commitTw.viewMode')">
            <DropdownMenuTrigger>
              <Button variant="ghost" size="icon">
                <MoreVertical class="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent align="end" class="w-52">
            <DropdownMenuLabel>{{ t("commitTw.viewAs") }}</DropdownMenuLabel>
            <DropdownMenuItem
              :class="layout.commitTwMode === 'docked' ? 'bg-accent' : ''"
              @select="setMode('docked')"
            >
              {{ t("commitTw.docked") }}
            </DropdownMenuItem>
            <DropdownMenuItem
              :class="layout.commitTwMode === 'window' ? 'bg-accent' : ''"
              @select="setMode('window')"
            >
              {{ t("commitTw.window") }}
            </DropdownMenuItem>
            <DropdownMenuItem
              :class="layout.commitTwMode === 'float' ? 'bg-accent' : ''"
              @select="setMode('float')"
            >
              {{ t("commitTw.float") }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              :checked="layout.commitControlsHidden"
              @update:checked="(v: boolean) => (layout.commitControlsHidden = v)"
            >
              {{ t("commitTw.toggleControls") }}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tip :text="t('actions.refreshStatus')">
          <Button variant="ghost" size="icon" @click="changes.refresh()">
            <RefreshCw class="h-3.5 w-3.5" />
          </Button>
        </Tip>
        <Tip :text="t('actions.showDiff')">
          <Button variant="ghost" size="icon" @click="showDiffSelected">
            <FileDiff class="h-3.5 w-3.5" />
          </Button>
        </Tip>
        <Tip :text="t('settings.fields.showIgnoredFiles')">
          <Button variant="ghost" size="icon" @click="changes.toggleShowIgnored()">
            <Eye class="h-3.5 w-3.5" />
          </Button>
        </Tip>
        <template v-if="changes.stagingMode">
          <Tip :text="t('actions.stage')">
            <Button variant="ghost" size="icon" @click="stageSelected">
              <Plus class="h-3.5 w-3.5" />
            </Button>
          </Tip>
          <Tip :text="t('actions.unstage')">
            <Button variant="ghost" size="icon" @click="unstageSelected">
              <Minus class="h-3.5 w-3.5" />
            </Button>
          </Tip>
          <Tip :text="t('commitTw.stageAll')">
            <Button variant="ghost" size="xs" @click="stageAll">{{
              t("commitTw.stageAll")
            }}</Button>
          </Tip>
        </template>
        <template v-else>
          <Tip :text="t('changelist.new')">
            <Button variant="ghost" size="icon" @click="newChangelist">
              <ListPlus class="h-3.5 w-3.5" />
            </Button>
          </Tip>
          <Tip :text="t('changelist.new')">
            <Button variant="ghost" size="xs" @click="newChangelist">{{
              t("changelist.new")
            }}</Button>
          </Tip>
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
      <div v-else class="border-t px-2 py-1 text-[11px] text-muted-foreground">
        {{ t("commitTw.controlsHidden") }}
      </div>
    </template>

    <Teleport to="body">
      <div
        v-if="ctxMenu?.open"
        class="fixed inset-0 z-[9998]"
        @click="closeCtx"
        @contextmenu.prevent="closeCtx"
      >
        <div
          class="absolute z-[9999] min-w-40 rounded-md border bg-popover p-1 shadow-lg ring-1 ring-foreground/10"
          :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
          @click.stop
        >
          <button
            v-if="changes.stagingMode && ctxMenu.section !== 'staged'"
            type="button"
            class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
            @click="runCtx('stage')"
          >
            {{ t("actions.stage") }}
          </button>
          <button
            v-if="changes.stagingMode && ctxMenu.section === 'staged'"
            type="button"
            class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
            @click="runCtx('unstage')"
          >
            {{ t("actions.unstage") }}
          </button>
          <button
            type="button"
            class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
            @click="runCtx('ignore')"
          >
            {{ t("commitTw.ignore") }}
          </button>
          <button
            type="button"
            class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
            @click="runCtx('stash')"
          >
            {{ t("stash.create") }}
          </button>
          <button
            type="button"
            class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
            @click="runCtx('shelve')"
          >
            {{ t("shelf.create") }}
          </button>
          <button
            type="button"
            class="flex w-full rounded px-2 py-1.5 text-left text-[13px] text-destructive hover:bg-accent"
            @click="runCtx('untrack')"
          >
            {{ t("commitTw.untrack") }}
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
