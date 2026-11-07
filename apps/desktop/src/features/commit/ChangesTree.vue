<script setup lang="ts">
import { computed, ref } from "vue";
import { ChevronDown, ChevronRight } from "@lucide/vue";
import type { FileChange } from "@/lib/backend";
import { useChangesStore, type ChangesSection } from "@/stores/changesStore";
import {
  buildPathTree,
  flattenPathTree,
  type PathTreeFileMeta,
  type PathTreeNode,
} from "@/lib/path-tree/buildPathTree";
import FileTypeIcon from "@/components/files/FileTypeIcon.vue";
import { markContextHandled } from "@/lib/contextMenu";
import { useI18n } from "vue-i18n";
import { statusClass } from "./statusColor";

const { t } = useI18n();
const changes = useChangesStore();

const emit = defineEmits<{
  openDiff: [path: string, section: ChangesSection];
  openFile: [path: string];
  context: [payload: { path: string; section: ChangesSection; x: number; y: number }];
}>();

type FileMeta = PathTreeFileMeta & { change: FileChange; section: ChangesSection };

type HeaderRow = {
  kind: "header";
  section: ChangesSection;
  label: string;
  count: number;
  active?: boolean;
  listId?: string;
};

type FileRow = {
  kind: "file";
  section: ChangesSection;
  node: PathTreeNode<FileMeta>;
  expanded: boolean;
};

type Row = HeaderRow | FileRow;

/** Expand overrides keyed by `${section}::${folderId}`. */
const expanded = ref<Set<string>>(new Set());

function toMeta(files: FileChange[], section: ChangesSection): FileMeta[] {
  return files.map((f) => ({
    path: f.path,
    origPath: f.origPath,
    directoryLeaf: f.path.endsWith("/") || f.path.endsWith("\\"),
    change: f,
    section,
  }));
}

function sectionRows(section: ChangesSection, files: FileChange[]): FileRow[] {
  const tree = buildPathTree(toMeta(files, section));
  const keyPrefix = `${section}::`;
  const sectionExpanded = new Set<string>();
  for (const key of expanded.value) {
    if (key.startsWith(keyPrefix)) sectionExpanded.add(key.slice(keyPrefix.length));
    else if (key.startsWith(`!${keyPrefix}`)) {
      sectionExpanded.add(`!${key.slice(1 + keyPrefix.length)}`);
    }
  }
  return flattenPathTree(tree, sectionExpanded, true).map((r) => ({
    kind: "file" as const,
    section,
    node: r.node,
    expanded: r.expanded,
  }));
}

const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  if (changes.stagingMode) {
    out.push({ kind: "header", section: "staged", label: "Staged", count: changes.staged.length });
    out.push(...sectionRows("staged", changes.staged));
    out.push({
      kind: "header",
      section: "unstaged",
      label: "Unstaged",
      count: changes.unstaged.length,
    });
    out.push(...sectionRows("unstaged", changes.unstaged));
  } else {
    const lists = changes.changelists?.lists ?? [
      { id: "default", name: "Changes", comment: "", active: true },
    ];
    for (const list of lists) {
      const section = `changelist:${list.id}` as ChangesSection;
      const files = changes.filesForChangelist(list.id);
      out.push({
        kind: "header",
        section,
        label: list.name,
        count: files.length,
        active: list.active,
        listId: list.id,
      });
      out.push(...sectionRows(section, files));
    }
  }

  out.push({
    kind: "header",
    section: "unversioned",
    label: "Unversioned Files",
    count: changes.unversioned.length,
  });
  out.push(...sectionRows("unversioned", changes.unversioned));

  if (changes.showIgnoredFiles) {
    out.push({
      kind: "header",
      section: "ignored",
      label: "Ignored Files",
      count: changes.ignored.length,
    });
    out.push(...sectionRows("ignored", changes.ignored));
  }
  return out;
});

const isEmpty = computed(() => {
  if (changes.stagingMode) {
    return (
      !changes.staged.length &&
      !changes.unstaged.length &&
      !changes.unversioned.length &&
      (!changes.showIgnoredFiles || !changes.ignored.length)
    );
  }
  return (
    !changes.changed.length &&
    !changes.unversioned.length &&
    (!changes.showIgnoredFiles || !changes.ignored.length)
  );
});

function toggleFolder(section: ChangesSection, node: PathTreeNode<FileMeta>) {
  const openKey = `${section}::${node.id}`;
  const closedKey = `!${section}::${node.id}`;
  const next = new Set(expanded.value);
  const currentlyOpen = next.has(closedKey) ? false : next.has(openKey) ? true : true;
  if (currentlyOpen) {
    next.delete(openKey);
    next.add(closedKey);
  } else {
    next.delete(closedKey);
    next.add(openKey);
  }
  expanded.value = next;
}

function onClick(row: FileRow, e: MouseEvent) {
  const node = row.node;
  if (node.kind === "folder" && node.children?.length) {
    toggleFolder(row.section, node);
    return;
  }
  const file = node.file?.change;
  if (!file) return;
  const multi = e.metaKey || e.ctrlKey;
  changes.select(file.path, row.section, multi);
  // IDEA-like: single-click selection updates Diff immediately (GIT-34).
  if (!multi) emit("openDiff", file.path, row.section);
}

function onDblClick(row: FileRow) {
  const file = row.node.file?.change;
  if (!file) return;
  emit("openDiff", file.path, row.section);
}

function onKeydown(row: FileRow, e: KeyboardEvent) {
  const file = row.node.file?.change;
  if (!file) return;
  if (e.key === "F4") {
    e.preventDefault();
    emit("openFile", file.path);
  }
}

function onContext(row: FileRow, e: MouseEvent) {
  const file = row.node.file?.change;
  if (!file) return;
  markContextHandled(e);
  if (!changes.selectedPaths.includes(file.path)) {
    changes.select(file.path, row.section, false);
  }
  emit("context", { path: file.path, section: row.section, x: e.clientX, y: e.clientY });
}

function showCheckbox(row: FileRow) {
  return (
    !changes.stagingMode &&
    !!row.node.file?.change &&
    row.section !== "ignored" &&
    (row.node.kind === "file" || !!row.node.file.directoryLeaf)
  );
}

function isSelected(row: FileRow) {
  const path = row.node.file?.change.path;
  return (
    !!path &&
    changes.selectedPaths.includes(path) &&
    changes.selectedSection === row.section
  );
}

function labelFor(node: PathTreeNode<FileMeta>) {
  const f = node.file?.change;
  if (f?.origPath) {
    const from = f.origPath.replace(/\\/g, "/").split("/").pop();
    return `${from} → ${node.name}`;
  }
  return node.name;
}

function rowKey(row: Row, i: number) {
  if (row.kind === "header") return `h-${row.section}-${row.label}`;
  return `f-${row.section}-${row.node.id}-${i}`;
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-auto text-[12.5px]">
    <template v-for="(row, i) in rows" :key="rowKey(row, i)">
      <div
        v-if="row.kind === 'header'"
        class="flex h-[22px] items-center gap-1 px-2 text-foreground"
      >
        <span :class="row.active ? 'font-bold' : 'font-medium'">{{ row.label }}</span>
        <span class="text-muted-foreground">({{ row.count }})</span>
      </div>
      <div
        v-else
        class="flex h-[22px] cursor-pointer items-center gap-0.5 pr-2"
        :class="
          isSelected(row)
            ? 'bg-selection text-selection-foreground'
            : 'hover:bg-hover-surface'
        "
        :style="{ paddingLeft: `${8 + row.node.depth * 12}px` }"
        tabindex="0"
        @click="onClick(row, $event)"
        @dblclick="onDblClick(row)"
        @contextmenu="onContext(row, $event)"
        @keydown="onKeydown(row, $event)"
      >
        <button
          v-if="row.node.kind === 'folder' && row.node.children?.length"
          type="button"
          class="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center text-muted-foreground"
          @click.stop="toggleFolder(row.section, row.node)"
        >
          <ChevronDown v-if="row.expanded" class="h-3 w-3" />
          <ChevronRight v-else class="h-3 w-3" />
        </button>
        <span v-else class="inline-block h-4 w-4 shrink-0" />
        <input
          v-if="showCheckbox(row)"
          type="checkbox"
          class="mr-0.5 cursor-pointer accent-foreground"
          :checked="changes.checkedPaths.includes(row.node.file!.change.path)"
          @click.stop
          @change="changes.toggleChecked(row.node.file!.change.path)"
        />
        <FileTypeIcon
          :name="row.node.name"
          :kind="row.node.kind"
          :expanded="row.expanded"
        />
        <span
          class="min-w-0 truncate"
          :class="row.node.file ? statusClass(row.node.file.change.kind) : 'text-foreground'"
        >
          {{ labelFor(row.node) }}
        </span>
      </div>
    </template>
    <div v-if="isEmpty" class="px-3 py-6 text-xs text-muted-foreground">
      {{ t("empty.noChanges") }}
    </div>
  </div>
</template>
