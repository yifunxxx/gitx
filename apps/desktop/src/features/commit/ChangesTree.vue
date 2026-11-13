<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { ChevronDown, ChevronRight } from "@lucide/vue";
import type { ChangesListMode, FileChange } from "@/lib/backend";
import { useChangesStore, type ChangesSection } from "@/stores/changesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  buildPathTree,
  type PathTreeFileMeta,
  type PathTreeNode,
} from "@/lib/path-tree/buildPathTree";
import FileTypeIcon from "@/components/files/FileTypeIcon.vue";
import VirtualList from "@/components/common/VirtualList.vue";
import IndeterminateCheckbox from "@/components/common/IndeterminateCheckbox.vue";
import { markContextHandled } from "@/lib/contextMenu";
import { useI18n } from "vue-i18n";
import { statusClass } from "./statusColor";

const { t } = useI18n();
const changes = useChangesStore();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const emit = defineEmits<{
  openDiff: [path: string, section: ChangesSection];
  openFile: [path: string];
  context: [
    payload: {
      path: string | null;
      section: ChangesSection;
      x: number;
      y: number;
      header: boolean;
    },
  ];
}>();
type FileMeta = PathTreeFileMeta & { change: FileChange };
type Section = { section: ChangesSection; label: string; files: FileChange[]; active?: boolean };
type Position = {
  key: string;
  section: ChangesSection;
  parent: string | null;
  level: number;
  position: number;
  siblings: number;
  expanded: boolean;
};
type HeaderRow = Position & { kind: "header"; label: string; count: number; active?: boolean };
type FileRow = Position & { kind: "file"; node: PathTreeNode<FileMeta> };
type Row = HeaderRow | FileRow;

const ROW_H = 22;
const tree = ref<HTMLElement | null>(null);
const list = ref<{
  el: HTMLElement | null;
  scrollToIndex: (index: number) => void;
  isIndexVisible: (index: number) => boolean;
} | null>(null);
const idPrefix = `changes-${useId()}`;
const rowId = (row: Row) => `${idPrefix}-${encodeURIComponent(row.key)}`;
const collapsed = ref(new Set<string>());
const currentKey = ref<string | null>(null);
const anchorKey = ref<string | null>(null);

const listMode = computed<ChangesListMode>(
  () => settings.settings?.git?.changesListMode ?? "tree",
);

// Building/sorting the path trees depends only on repository data, never on
// scrolling, selection or expanding a folder.
const sections = computed(() => {
  const groups: Section[] = changes.stagingMode
    ? [
        { section: "staged", label: "Staged", files: changes.staged },
        { section: "unstaged", label: "Unstaged", files: changes.unstaged },
      ]
    : (changes.changelists?.lists ?? [{ id: "default", name: "Changes", active: true }]).map(
        (item) => ({
          section: `changelist:${item.id}` as ChangesSection,
          label: item.name,
          files: changes.filesForChangelist(item.id),
          active: item.active,
        }),
      );
  groups.push({
    section: "unversioned",
    label: t("changelist.unversioned"),
    files: changes.unversioned,
  });
  if (changes.showIgnoredFiles)
    groups.push({ section: "ignored", label: t("changelist.ignored"), files: changes.ignored });
  return groups.map((group) => {
    const metas: FileMeta[] = group.files.map((file) => ({
      path: file.path,
      origPath: file.origPath,
      change: file,
      directoryLeaf: file.path.endsWith("/") || file.path.endsWith("\\"),
    }));
    return {
      ...group,
      metas,
      nodes: listMode.value === "tree" ? buildPathTree(metas) : [],
    };
  });
});
const isEmpty = computed(() => sections.value.every((section) => !section.files.length));
const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  const flat = listMode.value === "flat";
  for (const [index, group] of sections.value.entries()) {
    const key = JSON.stringify([group.section]);
    const header: HeaderRow = {
      kind: "header",
      key,
      section: group.section,
      label: group.label,
      count: group.files.length,
      active: group.active,
      expanded: !collapsed.value.has(key),
      parent: null,
      level: 1,
      position: index + 1,
      siblings: sections.value.length,
    };
    out.push(header);
    if (!header.expanded) continue;

    if (flat) {
      const files = [...group.metas].sort((a, b) => a.path.localeCompare(b.path));
      files.forEach((meta, position) => {
        const name = meta.path.replace(/\\/g, "/");
        out.push({
          kind: "file",
          key: JSON.stringify([group.section, meta.path]),
          section: group.section,
          node: {
            id: meta.path,
            name,
            kind: meta.directoryLeaf ? "folder" : "file",
            depth: 0,
            file: meta,
          },
          expanded: false,
          parent: key,
          level: 2,
          position: position + 1,
          siblings: files.length,
        });
      });
      continue;
    }

    // Iterative DFS — preserve parent keys for ArrowLeft / collapse ancestry.
    const stack: { nodes: PathTreeNode<FileMeta>[]; parent: string; index: number }[] = [
      { nodes: group.nodes, parent: key, index: 0 },
    ];
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      if (frame.index >= frame.nodes.length) {
        stack.pop();
        continue;
      }
      const node = frame.nodes[frame.index]!;
      const position = frame.index + 1;
      frame.index += 1;
      const rowKey = JSON.stringify([group.section, node.id]);
      const isFolder = !!node.children?.length;
      const expanded = isFolder && !collapsed.value.has(rowKey);
      out.push({
        kind: "file",
        key: rowKey,
        section: group.section,
        node,
        expanded,
        parent: frame.parent,
        level: node.depth + 2,
        position,
        siblings: frame.nodes.length,
      });
      if (expanded) {
        stack.push({ nodes: node.children!, parent: rowKey, index: 0 });
      }
    }
  }
  return out;
});
const indices = computed(() => new Map(rows.value.map((row, index) => [row.key, index])));
const currentIndex = computed(() => indices.value.get(currentKey.value ?? "") ?? 0);
const current = computed(() => rows.value[currentIndex.value]);
const activeDescendant = computed(() =>
  current.value && (list.value?.isIndexVisible(currentIndex.value) ?? currentIndex.value === 0)
    ? rowId(current.value)
    : undefined,
);
const selected = computed(() => new Set(changes.selectedPaths));
const checked = computed(() => new Set(changes.checkedPaths));

watch(
  [() => workspace.repoPath, () => changes.stagingMode],
  () => {
    collapsed.value = new Set();
    currentKey.value = anchorKey.value = null;
  },
  { flush: "sync" },
);
watch(
  rows,
  (next, previous = []) => {
    if (anchorKey.value && !indices.value.has(anchorKey.value)) anchorKey.value = null;
    if (currentKey.value && indices.value.has(currentKey.value)) return;
    const oldIndex = previous.findIndex((row) => row.key === currentKey.value);
    let parent: string | null = previous[oldIndex]?.parent ?? null;
    // Collapsing an ancestor moves the active descendant back to that ancestor.
    while (parent && (!indices.value.has(parent) || !collapsed.value.has(parent)))
      parent = previous.find((row) => row.key === parent)?.parent ?? null;
    currentKey.value =
      parent ?? next[Math.max(0, Math.min(oldIndex, next.length - 1))]?.key ?? null;
  },
  { immediate: true },
);

function focusRow(row: Row) {
  currentKey.value = row.key;
  tree.value?.focus({ preventScroll: true });
  list.value?.scrollToIndex(indices.value.get(row.key) ?? 0);
}
function expandable(row: Row) {
  return row.kind === "header" ? row.count > 0 : !!row.node.children?.length;
}
function toggle(row: Row) {
  if (!expandable(row)) return;
  focusRow(row);
  const next = new Set(collapsed.value);
  if (row.expanded) next.add(row.key);
  else next.delete(row.key);
  collapsed.value = next;
}
function filePath(row: Row) {
  return row.kind === "file" && !row.node.children?.length ? row.node.file?.change.path : undefined;
}
function selectRow(
  row: Row,
  event: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
  focusOnly = false,
) {
  focusRow(row);
  const path = filePath(row);
  if (!path || focusOnly) return;
  const multi = event.ctrlKey || event.metaKey;
  const anchor = anchorKey.value ? rows.value[indices.value.get(anchorKey.value) ?? -1] : undefined;
  if (event.shiftKey && anchor?.section === row.section && filePath(anchor)) {
    const from = indices.value.get(anchor.key)!;
    const to = indices.value.get(row.key)!;
    const paths = rows.value
      .slice(Math.min(from, to), Math.max(from, to) + 1)
      .filter((item) => item.section === row.section)
      .map(filePath)
      .filter((path): path is string => !!path);
    changes.selectedPaths =
      multi && changes.selectedSection === row.section
        ? [...new Set([...changes.selectedPaths, ...paths])]
        : paths;
    changes.selectedSection = row.section;
  } else {
    changes.select(path, row.section, multi && !event.shiftKey);
    anchorKey.value = row.key;
  }
  if (!multi && !event.shiftKey) emit("openDiff", path, row.section);
}
function onClick(row: Row, event: MouseEvent) {
  if (event.altKey) return;
  if (expandable(row)) toggle(row);
  else selectRow(row, event);
}
function onDblClick(row: Row, event: MouseEvent) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const path = filePath(row);
  if (path) emit("openDiff", path, row.section);
}
function showCheckbox(row: Row) {
  return (
    !changes.stagingMode &&
    row.section !== "ignored" &&
    (row.kind === "header" ? row.count > 0 : !!filePath(row))
  );
}
function checkState(row: Row): boolean | "mixed" | undefined {
  if (!showCheckbox(row)) return undefined;
  if (row.kind === "file") return checked.value.has(filePath(row)!);
  const state = changes.checkStateForSection(row.section);
  return state === "partial" ? "mixed" : state === "all";
}
function toggleCheck(row: Row) {
  focusRow(row);
  if (!showCheckbox(row)) return;
  if (row.kind === "header") changes.toggleCheckSection(row.section);
  else changes.toggleChecked(filePath(row)!);
}
function isSelected(row: Row) {
  const path = filePath(row);
  return !!path && changes.selectedSection === row.section && selected.value.has(path);
}
function openContext(row: Row, x: number, y: number) {
  focusRow(row);
  if (row.kind === "header") {
    // Changelist headers (including empty custom lists) need a menu for Delete / Move.
    if (!row.section.startsWith("changelist:")) return;
    if (changes.selectedSection !== row.section) {
      changes.selectedSection = row.section;
      changes.selectedPaths = [];
    }
    emit("context", {
      path: null,
      section: row.section,
      x,
      y,
      header: true,
    });
    return;
  }
  const path = filePath(row);
  if (!path) return;
  if (!isSelected(row)) {
    changes.select(path, row.section);
    anchorKey.value = row.key;
  }
  emit("context", { path, section: row.section, x, y, header: false });
}
function onContext(row: Row, event: MouseEvent) {
  if (row.kind === "header") {
    if (!row.section.startsWith("changelist:")) return;
  } else if (!filePath(row)) {
    return;
  }
  markContextHandled(event);
  openContext(row, event.clientX, event.clientY);
}
function onKeydown(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    (event.target as HTMLElement).closest("input,button,textarea,select,[contenteditable=true]")
  )
    return;
  const row = current.value;
  if (!row) return;
  const multi = event.ctrlKey || event.metaKey;
  const index = currentIndex.value;
  const page = Math.max(1, Math.floor((list.value?.el?.clientHeight || 400) / ROW_H));
  const target =
    event.key === "ArrowDown"
      ? index + 1
      : event.key === "ArrowUp"
        ? index - 1
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.value.length - 1
            : event.key === "PageDown"
              ? index + page
              : event.key === "PageUp"
                ? index - page
                : null;
  if (target !== null) {
    event.preventDefault();
    event.stopPropagation();
    selectRow(
      rows.value[Math.max(0, Math.min(rows.value.length - 1, target))]!,
      event,
      multi && !event.shiftKey,
    );
    return;
  }
  if (event.repeat) return;
  const contextKey =
    !multi &&
    ((event.key === "F10" && event.shiftKey) || (event.key === "ContextMenu" && !event.shiftKey));
  if (
    contextKey &&
    (filePath(row) || (row.kind === "header" && row.section.startsWith("changelist:")))
  ) {
    event.preventDefault();
    event.stopPropagation();
    const bounds =
      document.getElementById(rowId(row))?.getBoundingClientRect() ??
      tree.value!.getBoundingClientRect();
    openContext(row, bounds.left + 20, bounds.bottom);
    return;
  }
  if (event.shiftKey || (multi && event.key !== " ")) return;
  if (!["ArrowLeft", "ArrowRight", "Enter", "F4", " "].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "ArrowLeft") {
    if (expandable(row) && row.expanded) toggle(row);
    else if (row.parent) focusRow(rows.value[indices.value.get(row.parent)!]!);
  } else if (event.key === "ArrowRight") {
    if (expandable(row)) {
      if (!row.expanded) toggle(row);
      else selectRow(rows.value[index + 1]!, event);
    }
  } else if (event.key === "Enter") {
    if (expandable(row)) toggle(row);
    else if (filePath(row)) {
      if (!isSelected(row)) {
        changes.select(filePath(row)!, row.section);
        anchorKey.value = row.key;
      }
      emit("openDiff", filePath(row)!, row.section);
    }
  } else if (event.key === "F4") {
    if (filePath(row)) emit("openFile", filePath(row)!);
  } else if (multi || changes.stagingMode) {
    if (filePath(row)) {
      changes.select(filePath(row)!, row.section, true);
      anchorKey.value = row.key;
    }
  } else toggleCheck(row);
}
function labelFor(node: PathTreeNode<FileMeta>) {
  const file = node.file?.change;
  if (file?.origPath) {
    const from = file.origPath.replace(/\\/g, "/").split("/").pop();
    return `${from} → ${node.name}`;
  }
  return node.name;
}
</script>

<template>
  <div v-if="isEmpty" class="min-h-0 flex-1 px-3 py-6 text-xs text-muted-foreground">
    {{ t("empty.noChanges") }}
  </div>
  <div
    v-else
    ref="tree"
    role="tree"
    tabindex="0"
    aria-multiselectable="true"
    :aria-label="t('commitTw.changesTree')"
    :aria-activedescendant="activeDescendant"
    class="changes-tree flex min-h-0 flex-1 flex-col text-[12.5px] outline-none"
    @keydown="onKeydown"
    @focus.self="list?.scrollToIndex(currentIndex)"
  >
    <VirtualList
      ref="list"
      :items="rows"
      :item-height="ROW_H"
      :overscan="16"
      :get-key="(row) => row.key"
      :scroll-tabindex="-1"
      recycle-keys
      preserve-scroll-anchor
    >
      <template #default="{ item: row }">
        <div
          :id="rowId(row)"
          role="treeitem"
          :aria-label="row.kind === 'header' ? `${row.label} (${row.count})` : labelFor(row.node)"
          :aria-level="row.level"
          :aria-posinset="row.position"
          :aria-setsize="row.siblings"
          :aria-expanded="expandable(row) ? row.expanded : undefined"
          :aria-selected="filePath(row) ? isSelected(row) : undefined"
          :aria-checked="checkState(row)"
          :data-current="row.key === current?.key"
          :data-path="filePath(row)"
          :data-section="row.section"
          class="flex h-[22px] cursor-pointer items-center gap-0.5 pr-2"
          :class="
            isSelected(row)
              ? 'bg-selection text-selection-foreground'
              : 'text-foreground hover:bg-hover-surface'
          "
          :style="{
            paddingLeft: `${
              row.kind === 'header' ? 8 : listMode === 'flat' ? 20 : 20 + row.node.depth * 12
            }px`
          }"
          @click="onClick(row, $event)"
          @dblclick="onDblClick(row, $event)"
          @contextmenu="onContext(row, $event)"
        >
          <button
            v-if="expandable(row)"
            type="button"
            tabindex="-1"
            :aria-label="row.kind === 'header' ? row.label : labelFor(row.node)"
            :aria-expanded="row.expanded"
            class="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
            @mousedown.prevent
            @click.stop="toggle(row)"
          >
            <ChevronDown v-if="row.expanded" class="h-3 w-3" />
            <ChevronRight v-else class="h-3 w-3" />
          </button>
          <span v-else class="inline-block h-4 w-4 shrink-0" />
          <template v-if="row.kind === 'header'">
            <IndeterminateCheckbox
              v-if="showCheckbox(row)"
              tabindex="-1"
              :checked="checkState(row) === true"
              :indeterminate="checkState(row) === 'mixed'"
              :title="t('commitTw.selectAll')"
              @mousedown.prevent
              @change="toggleCheck(row)"
            />
            <span :class="row.active ? 'font-bold' : 'font-medium'">{{ row.label }}</span>
            <span class="text-muted-foreground">({{ row.count }})</span>
          </template>
          <template v-else>
            <input
              v-if="showCheckbox(row)"
              type="checkbox"
              tabindex="-1"
              class="mr-0.5 cursor-pointer accent-foreground"
              :checked="checkState(row) === true"
              :aria-label="labelFor(row.node)"
              @mousedown.prevent
              @click.stop
              @change="toggleCheck(row)"
            />
            <FileTypeIcon :name="row.node.name" :kind="row.node.kind" :expanded="row.expanded" />
            <span
              class="min-w-0 truncate"
              :class="row.node.file ? statusClass(row.node.file.change.kind) : 'text-foreground'"
            >
              {{ labelFor(row.node) }}
            </span>
          </template>
        </div>
      </template>
    </VirtualList>
  </div>
</template>

<style scoped>
.changes-tree:focus-visible [data-current="true"] {
  outline: 1px solid var(--color-ring);
  outline-offset: -1px;
}
</style>
