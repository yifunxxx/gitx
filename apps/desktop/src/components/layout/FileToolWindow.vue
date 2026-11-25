<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FolderPlus,
  LoaderCircle,
  RefreshCw,
} from "@lucide/vue";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import VirtualList from "@/components/common/VirtualList.vue";
import FileTypeIcon from "@/components/files/FileTypeIcon.vue";
import { owningRepository } from "@/features/file-tree/fileRepository";
import { useFileTreeStore } from "@/stores/fileTreeStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useChangesStore } from "@/stores/changesStore";
import { useFileViewerStore } from "@/stores/fileViewerStore";
import { useFileOperationsStore } from "@/stores/fileOperationsStore";
import type { FsOperation } from "@/lib/backend";
import { useHistoryStore } from "@/stores/historyStore";
import { openChangeDiff } from "@/features/commit/openChangeDiff";
import { statusClass } from "@/features/commit/statusColor";
import { changeLocation } from "@/features/commit/changeLocation";
import {
  projectFileDiffSection,
  projectFileStatusLabel,
} from "@/features/file-tree/projectFileStatus";
import { relativeToRoot } from "@/lib/projectFilePath";
import { requestTerminalDirectory } from "@/features/terminal/terminalDirectoryRequest";
import { commands } from "@/lib/backend/bindings";
import { markContextHandled } from "@/lib/contextMenu";
import { formatErrorMessage } from "@/lib/errors";
import { isTauri } from "@/lib/utils";
import { toast } from "@/composables/useToast";

type FileRow = ReturnType<typeof useFileTreeStore>["rows"][number];
type FileAction =
  | "openFile"
  | "showDiff"
  | "showHistory"
  | "openExplorer"
  | "openTerminal"
  | "copyPath"
  | "copyRelativePath";
const { t } = useI18n();
const files = useFileTreeStore();
const workspace = useWorkspaceStore();
const layout = useLayoutStore();
const changes = useChangesStore();
const viewer = useFileViewerStore();
const operations = useFileOperationsStore();
const history = useHistoryStore();
const tree = ref<HTMLElement | null>(null);
const list = ref<{
  el: HTMLElement | null;
  scrollToIndex(index: number): void;
  isIndexVisible(index: number): boolean;
} | null>(null);
const prefix = useId();
let disposed = false;
const visible = computed(() => layout.activeLeftTab === "file" && layout.leftOpen);
const currentIndex = computed(() =>
  Math.max(
    0,
    files.rows.findIndex((row) => row.path === files.selectedPath),
  ),
);
const current = computed(() => files.rows[currentIndex.value]);
const selectedRows = computed(() =>
  files.rows.filter((row) => files.selectedPath === row.path),
);
const rowId = (row: FileRow) => `${prefix}-${encodeURIComponent(row.key)}`;
const activeDescendant = computed(() =>
  current.value && list.value?.isIndexVisible(currentIndex.value)
    ? rowId(current.value)
    : undefined,
);
const statuses = computed(
  () =>
    new Map(
      changes.snapshot?.repoId === workspace.repoId
        ? changes.snapshot.files.map((file) => [file.path, file])
        : [],
    ),
);

function repoPath(row: FileRow) {
  const repository = owner(row);
  if (repository && repository.id !== workspace.repoId) return null;
  return workspace.isRepo && workspace.folderPath && workspace.repoPath
    ? relativeToRoot(workspace.folderPath, row.path, workspace.repoPath)
    : null;
}
function owner(row: FileRow) {
  return workspace.folderPath
    ? owningRepository(workspace.folderPath, row.path, workspace.roots ?? [])
    : undefined;
}
function change(row: FileRow) {
  const path = repoPath(row);
  return row.kind === "file" && path ? statuses.value.get(path) : undefined;
}
function canHistory(row: FileRow) {
  return (
    row.kind === "file" &&
    !!repoPath(row) &&
    !["untracked", "ignored", "added"].includes(change(row)?.kind ?? "")
  );
}

type Menu = { row: FileRow; x: number; y: number; current: () => boolean; folder: string };
const menu = ref<Menu | null>(null);
function closeMenu() {
  menu.value = null;
}
watch(
  () => [
    workspace.folderPath,
    workspace.repoId,
    workspace.navigationToken(),
    workspace.appliedOpenToken(),
    visible.value,
  ],
  () => {
    closeMenu();
    if (visible.value && workspace.folderPath) void files.loadRoot();
  },
  { immediate: true, flush: "sync" },
);
watch(
  () => files.rows,
  () => {
    if (menu.value && !menu.value.current()) closeMenu();
  },
);
onBeforeUnmount(() => {
  disposed = true;
  closeMenu();
});

function capture(row: FileRow) {
  const folder = workspace.folderPath;
  const repository = workspace.repoId;
  const navigation = workspace.navigationToken();
  if (!folder) return;
  return {
    folder,
    current: () =>
      !disposed &&
      folder === workspace.folderPath &&
      repository === workspace.repoId &&
      navigation === workspace.navigationToken() &&
      files.rows.some((item) => item.key === row.key),
  };
}

async function runAction(action: FileAction, row: FileRow, source = capture(row)) {
  if (!source?.current()) return;
  const path = repoPath(row);
  try {
    switch (action) {
      case "openFile":
        if (row.kind === "file") await viewer.open(row.path, { folderPath: source.folder });
        break;
      case "showDiff": {
        const section = projectFileDiffSection(change(row));
        if (row.kind === "file" && path && section) await openChangeDiff(path, section);
        break;
      }
      case "showHistory":
        if (path && canHistory(row)) await history.openFileHistory(path);
        break;
      case "copyPath":
      case "copyRelativePath": {
        const text =
          action === "copyRelativePath"
            ? row.path
            : changeLocation(source.folder, row.path, row.kind === "directory").path;
        await navigator.clipboard.writeText(text);
        if (source.current()) toast({ title: t("commitTw.copiedPath"), description: text });
        break;
      }
      case "openExplorer":
      case "openTerminal": {
        if (!isTauri()) {
          toast({ title: t("terminal.desktopOnly") });
          break;
        }
        const location = changeLocation(source.folder, row.path, row.kind === "directory");
        if (action === "openExplorer") {
          if (row.kind === "directory") await commands.workspaceOpenDirectory(location.path);
          else await revealItemInDir(location.path);
        } else {
          requestTerminalDirectory(location.cwd, source.current);
          layout.bottomOpen = true;
          layout.activeBottomTab = "terminal";
        }
        break;
      }
    }
  } catch (error) {
    if (source.current())
      toast({ title: t("fileTree.actionFailed"), description: formatErrorMessage(error) });
  }
}

function select(row: FileRow) {
  files.selectedPath = row.path;
  tree.value?.focus({ preventScroll: true });
}
function click(row: FileRow, event: MouseEvent) {
  select(row);
  if (row.kind === "directory" && event.detail < 2) void files.toggle(row.path);
}
function openMenu(row: FileRow, event: MouseEvent) {
  markContextHandled(event);
  select(row);
  const source = capture(row);
  if (source) menu.value = { row, x: event.clientX, y: event.clientY, ...source };
}
function menuAction(action: FileAction) {
  const target = menu.value;
  closeMenu();
  if (target) void runAction(action, target.row, target);
}
function operate(operation: FsOperation, row?: FileRow) {
  closeMenu();
  if (operation === "createFile" || operation === "createDirectory") {
    const parent =
      row?.kind === "directory" ? row.path : (row?.path.split("/").slice(0, -1).join("/") ?? "");
    void operations.run(operation, [parent]);
  } else if (row)
    void operations.run(
      operation,
      operation === "rename" ? [row.path] : selectedRows.value.map((item) => item.path),
    );
}
async function selectIndex(index: number) {
  const row = files.rows[Math.min(Math.max(index, 0), files.rows.length - 1)];
  if (!row) return;
  select(row);
  await nextTick();
  if (!disposed && current.value?.key === row.key) list.value?.scrollToIndex(currentIndex.value);
}
function onKeydown(event: KeyboardEvent) {
  if (
    event.target !== event.currentTarget ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  const row = current.value;
  if (!row) return;
  if (event.key === "Delete" && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) operate("delete", row);
    return;
  }
  if (event.key === "F2" && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat && selectedRows.value.length === 1) operate("rename", row);
    return;
  }
  if ((event.key === "F10" && event.shiftKey) || (event.key === "ContextMenu" && !event.shiftKey)) {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    const source = capture(row);
    const bounds =
      document.getElementById(rowId(row))?.getBoundingClientRect() ??
      tree.value?.getBoundingClientRect();
    if (source && bounds) menu.value = { row, x: bounds.left + 24, y: bounds.bottom, ...source };
    return;
  }
  if (
    event.shiftKey ||
    ![
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "Enter",
      " ",
      "F4",
    ].includes(event.key)
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "ArrowDown") void selectIndex(currentIndex.value + 1);
  else if (event.key === "ArrowUp") void selectIndex(currentIndex.value - 1);
  else if (event.key === "Home") void selectIndex(0);
  else if (event.key === "End") void selectIndex(files.rows.length - 1);
  else if (event.key === "ArrowRight") {
    if (row.kind === "directory" && !row.expanded) void files.expand(row.path);
    else if ((files.rows[currentIndex.value + 1]?.depth ?? -1) > row.depth)
      void selectIndex(currentIndex.value + 1);
  } else if (event.key === "ArrowLeft") {
    if (row.kind === "directory" && row.expanded) files.collapse(row.path);
    else {
      let parent = currentIndex.value - 1;
      while (parent >= 0 && files.rows[parent]!.depth >= row.depth) --parent;
      if (parent >= 0) void selectIndex(parent);
    }
  } else if (!event.repeat) {
    if (event.key === " ") select(row);
    else if (event.key === "F4") void runAction("showDiff", row);
    else if (row.kind === "directory") void files.toggle(row.path);
    else void runAction("openFile", row);
  }
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-sidebar" data-gitx-context="projectFiles">
    <header
      class="flex h-8 shrink-0 items-center justify-between border-b px-3 text-xs font-medium"
    >
      <span>{{ t("toolWindows.file") }}</span>
      <div class="flex items-center gap-1">
        <button
          v-for="operation in ['createFile', 'createDirectory'] as const"
          :key="operation"
          type="button"
          class="rounded p-1 hover:bg-accent disabled:opacity-40"
          :disabled="!workspace.folderPath || operations.busy"
          :title="t(`fileOps.${operation}`)"
          :aria-label="t(`fileOps.${operation}`)"
          @click="operate(operation, files.selectedPath ? current : undefined)"
        >
          <component :is="operation === 'createFile' ? FilePlus : FolderPlus" class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          class="rounded p-1 hover:bg-accent disabled:opacity-40"
          :title="t('fileTree.refresh')"
          :aria-label="t('fileTree.refresh')"
          :disabled="!workspace.folderPath || files.loading"
          @click="files.refreshExpanded()"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="files.loading ? 'animate-spin' : ''" />
        </button>
      </div>
    </header>
    <EmptyState v-if="!workspace.folderPath" :title="t('empty.noFolder')" />
    <template v-else>
      <div class="shrink-0 border-b p-2">
        <input
          v-model="files.filter"
          type="search"
          :aria-label="t('fileTree.filter')"
          :placeholder="t('fileTree.filter')"
          class="w-full rounded border bg-background/50 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <ErrorState
        v-if="files.error && !files.rows.length"
        :title="t('fileTree.loadFailed')"
        :message="files.error"
      >
        <button
          type="button"
          class="rounded border px-3 py-1 text-xs hover:bg-accent"
          @click="files.loadRoot()"
        >
          {{ t("empty.retry") }}
        </button>
      </ErrorState>
      <div
        v-else-if="files.loading && !files.rows.length"
        class="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground"
        role="status"
      >
        <LoaderCircle class="h-4 w-4 animate-spin" />{{ t("common.loading") }}
      </div>
      <div
        v-else
        ref="tree"
        role="tree"
        tabindex="0"
        :aria-label="t('fileTree.tree')"
        :aria-activedescendant="activeDescendant"
        class="flex min-h-0 flex-1 flex-col text-xs outline-none"
        @keydown="onKeydown"
        @focus.self="list?.scrollToIndex(currentIndex)"
      >
        <div
          v-if="files.error"
          class="flex items-center gap-2 px-2 py-1 text-destructive"
          role="alert"
        >
          <span class="min-w-0 flex-1 truncate" :title="files.error">{{ files.error }}</span>
          <button type="button" @click="files.loadRoot()">{{ t("empty.retry") }}</button>
        </div>
        <EmptyState
          v-if="!files.rows.length"
          :title="t(files.filter ? 'fileTree.noMatches' : 'fileTree.empty')"
        />
        <VirtualList
          v-else
          ref="list"
          :items="files.rows"
          :item-height="24"
          :overscan="16"
          :get-key="(row) => row.key"
          preserve-scroll-anchor
        >
          <template #default="{ item: row }">
            <div
              :id="rowId(row)"
              role="treeitem"
              :aria-label="row.name"
              :aria-level="row.depth + 1"
              :aria-selected="files.selectedPath === row.path"
              :aria-expanded="row.kind === 'directory' ? row.expanded : undefined"
              :aria-busy="row.loading || undefined"
              :data-path="row.path"
              :data-kind="row.kind"
              :title="row.error ?? row.path"
              class="flex h-6 cursor-default select-none items-center gap-1 pr-2 hover:bg-hover-surface"
              :class="files.selectedPath === row.path ? 'bg-accent' : ''"
              :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
              @click="click(row, $event)"
              @dblclick="row.kind === 'file' && runAction('openFile', row)"
              @contextmenu="openMenu(row, $event)"
            >
              <button
                v-if="row.kind === 'directory'"
                type="button"
                tabindex="-1"
                class="flex h-4 w-4 shrink-0 items-center justify-center"
                :aria-label="
                  t(row.expanded ? 'pathTree.collapse' : 'pathTree.expand', { name: row.name })
                "
                @mousedown.prevent
                @click.stop="
                  select(row);
                  files.toggle(row.path);
                "
                @dblclick.stop
              >
                <LoaderCircle v-if="row.loading" class="h-3 w-3 animate-spin" />
                <ChevronDown v-else-if="row.expanded" class="h-3 w-3" />
                <ChevronRight v-else class="h-3 w-3" />
              </button>
              <span v-else class="w-4 shrink-0" />
              <FileTypeIcon
                :name="row.name"
                :kind="row.kind === 'directory' ? 'folder' : 'file'"
                :expanded="row.expanded"
              />
              <span
                class="min-w-0 flex-1 truncate"
                :class="change(row) ? statusClass(change(row)!.kind) : 'text-foreground'"
                >{{ row.name }}</span
              >
              <span
                v-if="change(row)"
                class="shrink-0 font-mono text-[10px]"
                :class="statusClass(change(row)!.kind)"
                data-file-status
                >{{ projectFileStatusLabel(change(row)!) }}</span
              >
              <button
                v-if="row.error"
                type="button"
                class="shrink-0 text-destructive underline"
                :aria-label="t('fileTree.retryDirectory', { name: row.name })"
                @click.stop="files.expand(row.path)"
                @dblclick.stop
              >
                {{ t("empty.retry") }}
              </button>
            </div>
          </template>
        </VirtualList>
      </div>
    </template>
    <ContextMenuSurface
      :open="!!menu"
      :anchor-x="menu?.x ?? 0"
      :anchor-y="menu?.y ?? 0"
      :label="t('fileTree.tree')"
      :estimated-height="270"
      @close="closeMenu"
    >
      <template v-if="menu">
        <button
          v-for="operation in [
            'createFile',
            'createDirectory',
            'rename',
            'copy',
            'move',
            'delete',
          ] as const"
          :key="operation"
          type="button"
          role="menuitem"
          class="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent disabled:opacity-40"
          :disabled="operations.busy || (operation === 'rename' && selectedRows.length !== 1)"
          @click="operate(operation, menu.row)"
        >
          {{ t(`fileOps.${operation}`) }}
        </button>
        <div role="separator" class="my-1 border-t" />
        <template v-if="menu.row.kind === 'file'">
          <button
            type="button"
            role="menuitem"
            class="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
            @click="menuAction('openFile')"
          >
            {{ t("commitTw.openFile") }}
          </button>
          <button
            type="button"
            role="menuitem"
            class="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
            :disabled="selectedRows.length !== 1 || !projectFileDiffSection(change(menu.row))"
            @click="menuAction('showDiff')"
          >
            {{ t("commitTw.showDiff") }}
          </button>
          <button
            type="button"
            role="menuitem"
            class="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
            :disabled="selectedRows.length !== 1 || !canHistory(menu.row)"
            @click="menuAction('showHistory')"
          >
            {{ t("commitTw.showHistory") }}
          </button>
          <div role="separator" class="my-1 border-t" />
        </template>
        <button
          v-for="action in [
            'openExplorer',
            'openTerminal',
            'copyPath',
            'copyRelativePath',
          ] as const"
          :key="action"
          type="button"
          role="menuitem"
          class="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
          @click="menuAction(action)"
        >
          {{ t(`commitTw.${action}`) }}
        </button>
      </template>
    </ContextMenuSurface>
  </section>
</template>
