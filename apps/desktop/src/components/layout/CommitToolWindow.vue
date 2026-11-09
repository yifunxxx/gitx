<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Plus, Minus, RefreshCw, ListPlus } from "@lucide/vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import Skeleton from "@/components/common/Skeleton.vue";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import ChangesTree from "@/features/commit/ChangesTree.vue";
import CommitMessageEditor from "@/features/commit/CommitMessageEditor.vue";
import RepoStateBanner from "@/features/merge/RepoStateBanner.vue";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore, type ChangesSection } from "@/stores/changesStore";
import { openChangeDiff } from "@/features/commit/openChangeDiff";
import { useLayoutStore } from "@/stores/layoutStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useStashShelfStore } from "@/stores/stashShelfStore";
import { useFileViewerStore } from "@/stores/fileViewerStore";
import { useHistoryStore } from "@/stores/historyStore";
import { toast } from "@/composables/useToast";
import { confirmDialog, promptDialog } from "@/composables/useConfirm";
import { getBackend } from "@/lib/backend";
import { runAction } from "@/actions";

const { t } = useI18n();
const workspace = useWorkspaceStore();
const changes = useChangesStore();
const layout = useLayoutStore();
const rewrite = useRewriteStore();
const stashShelf = useStashShelfStore();
const files = useFileViewerStore();
const history = useHistoryStore();

const ctxMenu = ref<{
  open: boolean;
  x: number;
  y: number;
  path: string;
  section: ChangesSection;
} | null>(null);

const showMessageEditor = computed(() => !layout.commitControlsHidden);

const ctxIsStaged = computed(() => ctxMenu.value?.section === "staged");
const ctxIsUnversioned = computed(() => ctxMenu.value?.section === "unversioned");
const ctxIsTrackedChange = computed(
  () =>
    !!ctxMenu.value &&
    ctxMenu.value.section !== "unversioned" &&
    ctxMenu.value.section !== "ignored",
);

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
  void openChangeDiff(path, section);
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
  const ok = await stashShelf.promptStash({
    paths: changes.selectedPaths.length ? [...changes.selectedPaths] : undefined,
    includeUntracked: changes.selectedSection === "unversioned",
  });
  if (!ok) return;
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
  if (!(await stashShelf.promptShelf(paths))) return;
  layout.bottomOpen = true;
  layout.activeBottomTab = stashShelf.combineTab ? "stashesShelves" : "shelf";
}

async function rollbackSelected() {
  if (!workspace.repoPath || !workspace.repoId) return;
  const paths = changes.selectedPaths;
  if (!paths.length) return;
  const ok = await confirmDialog({
    title: t("commitTw.rollbackTitle"),
    message: t("commitTw.rollbackConfirm"),
    destructive: true,
  });
  if (!ok) return;
  // Staging mode: unstage first so checkout restores both index + worktree.
  if (changes.stagingMode && changes.selectedSection === "staged") {
    await changes.unstage(paths);
  }
  for (const filePath of paths) {
    await getBackend().checkoutPathFromRev({
      repoId: workspace.repoId,
      path: workspace.repoPath,
      rev: "HEAD",
      filePath,
    });
  }
  toast({ title: t("commitTw.rollbackDone"), description: `${paths.length}` });
  await changes.refresh();
}

async function moveToChangelistSelected() {
  const paths = changes.selectedPaths;
  if (!paths.length) return;
  const name = await promptDialog({
    title: t("commitTw.moveToChangelistTitle"),
    placeholder: t("commitTw.moveToChangelistPrompt"),
    allowEmpty: false,
  });
  if (!name?.trim()) return;
  const target = name.trim();
  let list = changes.changelists?.lists.find((l) => l.name === target);
  if (!list) {
    await changes.createChangelist(target, false);
    list = changes.changelists?.lists.find((l) => l.name === target);
  }
  if (!list) return;
  await changes.moveToChangelist(paths, list.id);
  toast({ title: t("commitTw.moveToChangelist"), description: target });
}

async function copyPath(relative: boolean) {
  const path = changes.selectedPaths[0] ?? ctxMenu.value?.path;
  if (!path) return;
  const text =
    relative || !workspace.repoPath
      ? path
      : `${workspace.repoPath.replace(/[\\/]+$/, "")}/${path}`.replace(/\\/g, "/");
  await navigator.clipboard?.writeText(text);
  toast({ title: t("commitTw.copiedPath"), description: text });
}

async function createPatchSelected() {
  await runAction("Create Patch", {
    repoIds: workspace.toplevel ? [workspace.toplevel] : [],
    selection: { files: [...changes.selectedPaths] },
    source: "context",
    place: "Git.ContextMenu.Changes",
    folderPath: workspace.folderPath,
  });
}

function onContext(payload: { path: string; section: ChangesSection; x: number; y: number }) {
  layout.vcsPopupOpen = false;
  // Placement (flip / clamp / scroll) is handled by ContextMenuSurface.
  ctxMenu.value = {
    open: true,
    x: payload.x,
    y: payload.y,
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
    case "showDiff":
      showDiffSelected();
      break;
    case "showHistory": {
      const path = changes.selectedPaths[0];
      if (path) await history.openFileHistory(path);
      break;
    }
    case "openFile": {
      const path = changes.selectedPaths[0];
      if (path) openFile(path);
      break;
    }
    case "commit":
      layout.leftOpen = true;
      break;
    case "rollback":
      await rollbackSelected();
      break;
    case "stage":
      await stageSelected();
      break;
    case "unstage":
      await unstageSelected();
      break;
    case "add":
      await stageSelected();
      break;
    case "moveChangelist":
      await moveToChangelistSelected();
      break;
    case "newChangelist":
      await newChangelist();
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
    case "patch":
      await createPatchSelected();
      break;
    case "untrack":
      await stopTrackingSelected();
      break;
    case "copyPath":
      await copyPath(false);
      break;
    case "copyRelative":
      await copyPath(true);
      break;
    case "refresh":
      await changes.refresh();
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
      <span>{{ t("toolWindows.commit") }}</span>
      <div class="flex items-center gap-0.5">
        <Tip :text="t('actions.refreshStatus')">
          <Button variant="ghost" size="icon" @click="changes.refresh()">
            <RefreshCw class="h-3.5 w-3.5" />
          </Button>
        </Tip>
        <!-- Show Diff removed (GIT-38): left-click already opens Diff. -->
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
          <!-- Visible label → no tip with the same string (GIT-37). -->
          <Button variant="ghost" size="xs" class="gap-1" @click="newChangelist">
            <ListPlus class="h-3.5 w-3.5" />
            {{ t("changelist.new") }}
          </Button>
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

    <ContextMenuSurface
      :open="!!ctxMenu?.open"
      :anchor-x="ctxMenu?.x ?? 0"
      :anchor-y="ctxMenu?.y ?? 0"
      :width="240"
      :estimated-height="420"
      @close="closeCtx"
    >
      <button
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('showDiff')"
      >
        {{ t("commitTw.showDiff") }}
      </button>
      <button
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('showHistory')"
      >
        {{ t("commitTw.showHistory") }}
      </button>
      <button
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('openFile')"
      >
        {{ t("commitTw.openFile") }}
      </button>
      <div class="my-1 h-px bg-border" />
      <button
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('commit')"
      >
        {{ t("commitTw.commitFiles") }}
      </button>
      <button
        v-if="ctxIsTrackedChange"
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('rollback')"
      >
        {{ t("commitTw.rollback") }}
      </button>
      <div class="my-1 h-px bg-border" />
      <button
        v-if="changes.stagingMode && !ctxIsStaged && !ctxIsUnversioned"
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('stage')"
      >
        {{ t("actions.stage") }}
      </button>
      <button
        v-if="changes.stagingMode && ctxIsStaged"
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('unstage')"
      >
        {{ t("actions.unstage") }}
      </button>
      <button
        v-if="ctxIsUnversioned"
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('add')"
      >
        {{ t("actions.addToVcs") }}
      </button>
      <template
        v-if="ctxMenu && !changes.stagingMode && !ctxIsUnversioned && ctxMenu.section !== 'ignored'"
      >
        <button
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('moveChangelist')"
        >
          {{ t("commitTw.moveToChangelist") }}
        </button>
        <button
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('newChangelist')"
        >
          {{ t("changelist.new") }}
        </button>
      </template>
      <div class="my-1 h-px bg-border" />
      <button
        v-if="!ctxIsUnversioned"
        type="button"
        :disabled="stashShelf.busy"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('shelve')"
      >
        {{ t("shelf.create") }}
      </button>
      <button
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('stash')"
      >
        {{ t("stash.create") }}
      </button>
      <button
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('patch')"
      >
        {{ t("commitTw.createPatch") }}
      </button>
      <div class="my-1 h-px bg-border" />
      <button
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('ignore')"
      >
        {{ t("commitTw.ignore") }}
      </button>
      <button
        v-if="ctxIsTrackedChange"
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] text-destructive hover:bg-hover-surface"
        @click="runCtx('untrack')"
      >
        {{ t("commitTw.untrack") }}
      </button>
      <div class="my-1 h-px bg-border" />
      <button
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('copyPath')"
      >
        {{ t("commitTw.copyPath") }}
      </button>
      <button
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('copyRelative')"
      >
        {{ t("commitTw.copyRelativePath") }}
      </button>
      <div class="my-1 h-px bg-border" />
      <button
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('refresh')"
      >
        {{ t("actions.refreshStatus") }}
      </button>
    </ContextMenuSurface>
  </div>
</template>
