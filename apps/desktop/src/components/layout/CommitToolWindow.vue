<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Plus, Minus, RefreshCw, ListPlus, List, ListTree } from "@lucide/vue";
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
import { useSettingsStore } from "@/stores/settingsStore";
import { openChangeDiff } from "@/features/commit/openChangeDiff";
import { focusCommitUi } from "@/features/commit/focusCommitUi";
import { useLayoutStore } from "@/stores/layoutStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useStashShelfStore } from "@/stores/stashShelfStore";
import { useFileViewerStore } from "@/stores/fileViewerStore";
import { useHistoryStore } from "@/stores/historyStore";
import { toast } from "@/composables/useToast";
import { confirmDialog, promptDialog } from "@/composables/useConfirm";
import { getBackend, type ChangesListMode } from "@/lib/backend";
import { runAction } from "@/actions";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { openDialog } from "@/composables/useDialog";
import StopTrackingDialog from "@/features/commit/StopTrackingDialog.vue";
import RollbackChangesDialog from "@/features/commit/RollbackChangesDialog.vue";
import MoveToChangelistDialog from "@/features/commit/MoveToChangelistDialog.vue";
import { formatErrorMessage } from "@/lib/errors";
import { cloneJson } from "@/lib/clone";

const { t } = useI18n();
const workspace = useWorkspaceStore();
const changes = useChangesStore();
const settings = useSettingsStore();
const layout = useLayoutStore();
const rewrite = useRewriteStore();
const stashShelf = useStashShelfStore();
const files = useFileViewerStore();
const history = useHistoryStore();

const changesListMode = computed<ChangesListMode>(
  () => settings.settings?.git?.changesListMode ?? "tree",
);
const changesListModeTip = computed(() =>
  changesListMode.value === "tree"
    ? t("commitTw.listModeToggleTipTree")
    : t("commitTw.listModeToggleTipFlat"),
);

async function toggleChangesListMode() {
  const next: ChangesListMode = changesListMode.value === "tree" ? "flat" : "tree";
  const base = cloneJson(settings.settings ?? settings.emptySettings());
  await settings.save({
    ...base,
    git: { ...base.git, changesListMode: next },
  });
}

const ctxMenu = ref<{
  open: boolean;
  x: number;
  y: number;
  path: string | null;
  section: ChangesSection;
  header: boolean;
  target: ChangesTarget;
} | null>(null);

const captureRepository = useRepositoryAction(closeCtx);
watch(() => [changes.selectedSection, changes.stagingMode, ...changes.selectedPaths], closeCtx, {
  flush: "sync",
});
watch(
  () => changes.snapshot,
  () => {
    const menu = ctxMenu.value;
    if (!menu?.open || !changes.snapshot) return;
    const available =
      menu.section === "ignored"
        ? changes.ignored.map((file) => file.path)
        : changes.pathsForSection(menu.section);
    if (menu.target.paths.some((path) => !available.includes(path))) closeCtx();
  },
);

const showMessageEditor = computed(() => !layout.commitControlsHidden);

const ctxIsStaged = computed(() => ctxMenu.value?.section === "staged");
const ctxIsUnversioned = computed(() => ctxMenu.value?.section === "unversioned");
const ctxIsTrackedChange = computed(
  () =>
    !!ctxMenu.value &&
    !ctxMenu.value.header &&
    ctxMenu.value.section !== "unversioned" &&
    ctxMenu.value.section !== "ignored",
);
const ctxChangelistId = computed(() => {
  const section = ctxMenu.value?.section;
  return section?.startsWith("changelist:") ? section.slice("changelist:".length) : null;
});
const ctxCanDeleteChangelist = computed(
  () =>
    !!ctxMenu.value &&
    !changes.stagingMode &&
    !!ctxChangelistId.value &&
    ctxChangelistId.value !== "default",
);
const ctxShowMoveChangelist = computed(
  () =>
    !!ctxMenu.value &&
    !changes.stagingMode &&
    !ctxIsUnversioned.value &&
    ctxMenu.value.section !== "ignored" &&
    (!ctxMenu.value.header || ctxMenu.value.target.paths.length > 0),
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

function captureSelection(paths = changes.selectedPaths, section = changes.selectedSection) {
  return {
    ...captureRepository(),
    paths: [...paths],
    section,
    stagingMode: changes.stagingMode,
  };
}
type ChangesTarget = ReturnType<typeof captureSelection>;

async function stageSelected(target = captureSelection()) {
  if (!target.current() || !target.paths.length) return;
  if (target.section === "unversioned") await changes.add(target.paths);
  else await changes.stage(target.paths);
  if (target.current()) toast({ title: t("actions.stage"), description: `${target.paths.length}` });
}

async function unstageSelected(target = captureSelection()) {
  if (!target.current() || !target.paths.length) return;
  await changes.unstage(target.paths);
  if (target.current())
    toast({ title: t("actions.unstage"), description: `${target.paths.length}` });
}

async function stageAll() {
  const target = captureSelection([
    ...changes.unstaged.map((f) => f.path),
    ...changes.unversioned.map((f) => f.path),
  ]);
  if (!target.current() || !target.paths.length) return;
  await changes.stage(target.paths);
  if (target.current()) toast({ title: t("commitTw.stageAll") });
}

async function newChangelist(target = captureSelection()) {
  if (!target.current()) return;
  const name = await promptDialog({
    title: t("changelist.new"),
    placeholder: t("changelist.namePlaceholder"),
    allowEmpty: false,
  });
  if (!name?.trim() || !target.current()) return;
  const created = await changes.createChangelist(name.trim(), true);
  if (created && target.current()) toast({ title: t("changelist.new"), description: name.trim() });
}

async function ignoreSelected(target: ChangesTarget) {
  if (!target.current() || !target.paths.length) return;
  await changes.ignore(target.paths);
  if (target.current())
    toast({ title: t("commitTw.ignored"), description: `${target.paths.length}` });
}

async function stopTrackingSelected(target: ChangesTarget) {
  if (!target.current() || !target.paths.length) return;
  const choice = await openDialog<{ addToGitignore: boolean } | null>(StopTrackingDialog, {
    count: target.paths.length,
  });
  if (!choice || !target.current()) return;
  await changes.rmCached(target.paths, choice.addToGitignore);
  if (target.current())
    toast({ title: t("commitTw.untracked"), description: `${target.paths.length}` });
}

async function stashSelected(target: ChangesTarget) {
  if (!target.current() || !target.paths.length) return;
  const ok = await stashShelf.promptStash({
    paths: target.paths,
    includeUntracked: target.section === "unversioned",
  });
  if (!ok || !target.current()) return;
  layout.bottomOpen = true;
  layout.activeBottomTab = stashShelf.combineTab ? "stashesShelves" : "stash";
}

async function shelveSelected(target: ChangesTarget) {
  if (!target.current()) return;
  if (!(await stashShelf.promptShelf(target.paths)) || !target.current()) return;
  layout.bottomOpen = true;
  layout.activeBottomTab = stashShelf.combineTab ? "stashesShelves" : "shelf";
}

async function rollbackSelected(target: ChangesTarget) {
  if (!target.current() || !target.path || !target.repoId || !target.paths.length) return;
  const choice = await openDialog<{ paths: string[] } | null>(RollbackChangesDialog, {
    initialPaths: [...target.paths],
  });
  if (!choice?.paths.length || !target.current()) return;
  const paths = [...choice.paths];
  // Freeze the section as well as paths: confirmation may outlive selection.
  if (target.stagingMode && target.section === "staged") {
    const stagedSet = new Set(changes.staged.map((file) => file.path));
    const stagedPaths = paths.filter((path) => stagedSet.has(path));
    if (stagedPaths.length) await changes.unstage(stagedPaths);
  }
  for (const filePath of paths) {
    if (!target.current()) return;
    await getBackend().checkoutPathFromRev({
      repoId: target.repoId,
      path: target.path,
      rev: "HEAD",
      filePath,
    });
  }
  if (!target.current()) return;
  toast({ title: t("commitTw.rollbackDone"), description: `${paths.length}` });
  await changes.refresh();
}

async function moveToChangelistSelected(target: ChangesTarget) {
  if (!target.current() || !target.section) return;
  const sourceListId = target.section.startsWith("changelist:")
    ? target.section.slice("changelist:".length)
    : null;
  const choice = await openDialog<{
    paths: string[];
    targetListId: string | null;
    newName: string | null;
  } | null>(MoveToChangelistDialog, {
    initialPaths: [...target.paths],
    sourceListId,
  });
  if (!choice?.paths.length || !target.current()) return;
  let listId = choice.targetListId;
  let description = changes.changelists?.lists.find((list) => list.id === listId)?.name ?? "";
  if (choice.newName?.trim()) {
    const nameToUse = choice.newName.trim();
    const created = await changes.createChangelist(nameToUse, false);
    if (!created || !target.current()) return;
    listId = created.lists.find((list) => list.name === nameToUse)?.id ?? null;
    description = nameToUse;
  }
  if (!listId) return;
  const moved = await changes.moveToChangelist(choice.paths, listId);
  if (moved && target.current()) {
    toast({
      title: t("commitTw.moveToChangelist"),
      description: description || listId,
    });
  }
}

async function deleteChangelistSelected(target: ChangesTarget) {
  if (!target.current() || changes.stagingMode || !target.section) return;
  const listId = target.section.startsWith("changelist:")
    ? target.section.slice("changelist:".length)
    : null;
  if (!listId || listId === "default") return;
  const list = changes.changelists?.lists.find((item) => item.id === listId);
  if (!list) return;
  const ok = await confirmDialog({
    title: t("changelist.deleteTitle"),
    message: t("changelist.deleteConfirm", { name: list.name }),
    confirmLabel: t("changelist.delete"),
    destructive: true,
  });
  if (!ok || !target.current()) return;
  const deleted = await changes.deleteChangelist(listId, "default");
  if (deleted && target.current()) {
    toast({ title: t("changelist.deleted"), description: list.name });
  }
}

async function copyPath(target: ChangesTarget, relative: boolean) {
  const path = target.paths[0];
  if (!target.current() || !path) return;
  const text =
    relative || !target.path
      ? path
      : `${target.path.replace(/[\\/]+$/, "")}/${path}`.replace(/\\/g, "/");
  await navigator.clipboard?.writeText(text);
  if (target.current()) toast({ title: t("commitTw.copiedPath"), description: text });
}

async function createPatchSelected(target: ChangesTarget) {
  if (!target.current()) return;
  await runAction("Create Patch", {
    repoIds: target.repoId ? [target.repoId] : [],
    selection: { files: target.paths },
    source: "context",
    place: "Git.ContextMenu.Changes",
    folderPath: workspace.folderPath,
  });
}

/** Commit Files… — include selected paths in the next commit and focus the message box. */
async function commitFilesSelected(target: ChangesTarget) {
  if (!target.current() || !target.paths.length) return;
  if (target.stagingMode) {
    if (target.section === "unversioned") await changes.add(target.paths);
    else if (target.section !== "staged" && target.section !== "ignored") {
      await changes.stage(target.paths);
    }
  } else if (target.section !== "ignored") {
    changes.setChecked([...target.paths]);
  }
  if (!target.current()) return;
  await focusCommitUi();
}

function onContext(payload: {
  path: string | null;
  section: ChangesSection;
  x: number;
  y: number;
  header?: boolean;
}) {
  layout.vcsPopupOpen = false;
  const header = !!payload.header || !payload.path;
  let paths: string[];
  if (header) {
    paths =
      changes.selectedSection === payload.section && changes.selectedPaths.length
        ? [...changes.selectedPaths]
        : changes.pathsForSection(payload.section);
  } else if (
    changes.selectedSection === payload.section &&
    payload.path &&
    changes.selectedPaths.includes(payload.path)
  ) {
    paths = [...changes.selectedPaths];
  } else {
    paths = payload.path ? [payload.path] : [];
  }
  const target = captureSelection(paths, payload.section);
  if (!target.current()) return;
  ctxMenu.value = {
    open: true,
    x: payload.x,
    y: payload.y,
    path: payload.path,
    section: payload.section,
    header,
    target,
  };
}

function closeCtx() {
  if (ctxMenu.value) ctxMenu.value.open = false;
}

async function runCtx(action: string) {
  const menu = ctxMenu.value;
  if (!menu?.open) return;
  closeCtx();
  const target = menu.target;
  if (!target.current()) return;
  const path = target.paths[0];
  try {
    switch (action) {
      case "showDiff":
        if (path && target.section) await openChangeDiff(path, target.section);
        break;
      case "showHistory":
        if (path) await history.openFileHistory(path);
        break;
      case "openFile":
        if (path) await files.open(path);
        break;
      case "commit":
        await commitFilesSelected(target);
        break;
      case "rollback":
        await rollbackSelected(target);
        break;
      case "stage":
      case "add":
        await stageSelected(target);
        break;
      case "unstage":
        await unstageSelected(target);
        break;
      case "moveChangelist":
        await moveToChangelistSelected(target);
        break;
      case "deleteChangelist":
        await deleteChangelistSelected(target);
        break;
      case "newChangelist":
        await newChangelist(target);
        break;
      case "ignore":
        await ignoreSelected(target);
        break;
      case "shelve":
        await shelveSelected(target);
        break;
      case "stash":
        await stashSelected(target);
        break;
      case "patch":
        await createPatchSelected(target);
        break;
      case "untrack":
        await stopTrackingSelected(target);
        break;
      case "copyPath":
        await copyPath(target, false);
        break;
      case "copyRelative":
        await copyPath(target, true);
        break;
      case "refresh":
        await changes.refresh();
        break;
    }
  } catch (error) {
    if (target.current()) toast({ title: formatErrorMessage(error) });
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
        <Tip :text="changesListModeTip">
          <Button
            variant="ghost"
            size="icon"
            :aria-label="changesListModeTip"
            :aria-pressed="changesListMode === 'tree'"
            @click="toggleChangesListMode"
          >
            <ListTree v-if="changesListMode === 'tree'" class="h-3.5 w-3.5" />
            <List v-else class="h-3.5 w-3.5" />
          </Button>
        </Tip>
        <!-- Show Diff removed (GIT-38): left-click already opens Diff. -->
        <template v-if="changes.stagingMode">
          <Tip :text="t('actions.stage')">
            <Button variant="ghost" size="icon" @click="stageSelected()">
              <Plus class="h-3.5 w-3.5" />
            </Button>
          </Tip>
          <Tip :text="t('actions.unstage')">
            <Button variant="ghost" size="icon" @click="unstageSelected()">
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
          <Button variant="ghost" size="xs" class="gap-1" @click="newChangelist()">
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
      <template v-if="ctxMenu && !ctxMenu.header">
        <button
          role="menuitem"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('showDiff')"
        >
          {{ t("commitTw.showDiff") }}
        </button>
        <button
          role="menuitem"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('showHistory')"
        >
          {{ t("commitTw.showHistory") }}
        </button>
        <button
          role="menuitem"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('openFile')"
        >
          {{ t("commitTw.openFile") }}
        </button>
        <div class="my-1 h-px bg-border" />
      </template>
      <template v-if="ctxMenu && !ctxMenu.header">
        <button
          role="menuitem"
          v-if="ctxMenu.section !== 'ignored'"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('commit')"
        >
          {{ t("commitTw.commitFiles") }}
        </button>
        <button
          role="menuitem"
          v-if="ctxIsTrackedChange"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('rollback')"
        >
          {{ t("commitTw.rollback") }}
        </button>
        <div class="my-1 h-px bg-border" />
        <button
          role="menuitem"
          v-if="changes.stagingMode && !ctxIsStaged && !ctxIsUnversioned"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('stage')"
        >
          {{ t("actions.stage") }}
        </button>
        <button
          role="menuitem"
          v-if="changes.stagingMode && ctxIsStaged"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('unstage')"
        >
          {{ t("actions.unstage") }}
        </button>
        <button
          role="menuitem"
          v-if="ctxIsUnversioned"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('add')"
        >
          {{ t("actions.addToVcs") }}
        </button>
      </template>
      <template v-if="ctxShowMoveChangelist || (!changes.stagingMode && ctxMenu)">
        <button
          role="menuitem"
          v-if="ctxShowMoveChangelist"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('moveChangelist')"
        >
          {{ t("commitTw.moveToChangelist") }}
        </button>
        <button
          role="menuitem"
          v-if="!changes.stagingMode"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('newChangelist')"
        >
          {{ t("changelist.new") }}
        </button>
        <button
          role="menuitem"
          v-if="ctxCanDeleteChangelist"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] text-destructive hover:bg-hover-surface"
          @click="runCtx('deleteChangelist')"
        >
          {{ t("changelist.delete") }}
        </button>
      </template>
      <template v-if="ctxMenu && !ctxMenu.header">
        <div class="my-1 h-px bg-border" />
        <button
          role="menuitem"
          v-if="!ctxIsUnversioned"
          type="button"
          :disabled="stashShelf.busy"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('shelve')"
        >
          {{ t("shelf.create") }}
        </button>
        <button
          role="menuitem"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('stash')"
        >
          {{ t("stash.create") }}
        </button>
        <button
          role="menuitem"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('patch')"
        >
          {{ t("commitTw.createPatch") }}
        </button>
        <div class="my-1 h-px bg-border" />
        <button
          role="menuitem"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('ignore')"
        >
          {{ t("commitTw.ignore") }}
        </button>
        <button
          role="menuitem"
          v-if="ctxIsTrackedChange"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] text-destructive hover:bg-hover-surface"
          @click="runCtx('untrack')"
        >
          {{ t("commitTw.untrack") }}
        </button>
        <div class="my-1 h-px bg-border" />
        <button
          role="menuitem"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('copyPath')"
        >
          {{ t("commitTw.copyPath") }}
        </button>
        <button
          role="menuitem"
          type="button"
          class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
          @click="runCtx('copyRelative')"
        >
          {{ t("commitTw.copyRelativePath") }}
        </button>
      </template>
      <div class="my-1 h-px bg-border" />
      <button
        role="menuitem"
        type="button"
        class="flex w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-hover-surface"
        @click="runCtx('refresh')"
      >
        {{ t("actions.refreshStatus") }}
      </button>
    </ContextMenuSurface>
  </div>
</template>
