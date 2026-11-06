<script setup lang="ts">
import { computed } from "vue";
import type { FileChange } from "@/lib/backend";
import { useChangesStore, type ChangesSection } from "@/stores/changesStore";
import { statusClass } from "./statusColor";

const changes = useChangesStore();

const emit = defineEmits<{
  openDiff: [path: string, section: ChangesSection];
  openFile: [path: string];
  context: [payload: { path: string; section: ChangesSection; x: number; y: number }];
}>();

type Row = {
  kind: "header" | "file";
  section: ChangesSection;
  label: string;
  file?: FileChange;
  count?: number;
  active?: boolean;
  listId?: string;
};

const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  if (changes.stagingMode) {
    out.push({
      kind: "header",
      section: "staged",
      label: "Staged",
      count: changes.staged.length,
    });
    for (const f of changes.staged) {
      out.push({ kind: "file", section: "staged", label: f.path, file: f });
    }
    out.push({
      kind: "header",
      section: "unstaged",
      label: "Unstaged",
      count: changes.unstaged.length,
    });
    for (const f of changes.unstaged) {
      out.push({ kind: "file", section: "unstaged", label: f.path, file: f });
    }
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
      for (const f of files) {
        out.push({ kind: "file", section, label: f.path, file: f, listId: list.id });
      }
    }
  }

  out.push({
    kind: "header",
    section: "unversioned",
    label: "Unversioned Files",
    count: changes.unversioned.length,
  });
  for (const f of changes.unversioned) {
    out.push({ kind: "file", section: "unversioned", label: f.path, file: f });
  }

  if (changes.showIgnoredFiles) {
    out.push({
      kind: "header",
      section: "ignored",
      label: "Ignored Files",
      count: changes.ignored.length,
    });
    for (const f of changes.ignored) {
      out.push({ kind: "file", section: "ignored", label: f.path, file: f });
    }
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

function displayName(f: FileChange) {
  if (f.origPath) return `${f.origPath} → ${f.path}`;
  return f.path;
}

function onClick(row: Row, e: MouseEvent) {
  if (row.kind !== "file" || !row.file) return;
  changes.select(row.file.path, row.section, e.metaKey || e.ctrlKey);
}

function onDblClick(row: Row) {
  if (row.kind !== "file" || !row.file) return;
  emit("openDiff", row.file.path, row.section);
}

function onKeydown(row: Row, e: KeyboardEvent) {
  if (row.kind !== "file" || !row.file) return;
  if (e.key === "F4") {
    e.preventDefault();
    emit("openFile", row.file.path);
  }
}

function onContext(row: Row, e: MouseEvent) {
  if (row.kind !== "file" || !row.file) return;
  e.preventDefault();
  if (!changes.selectedPaths.includes(row.file.path)) {
    changes.select(row.file.path, row.section, false);
  }
  emit("context", { path: row.file.path, section: row.section, x: e.clientX, y: e.clientY });
}

function showCheckbox(row: Row) {
  return !changes.stagingMode && row.kind === "file" && row.file && row.section !== "ignored";
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-auto text-[12.5px]">
    <div
      v-for="(row, i) in rows"
      :key="`${row.section}-${row.label}-${i}`"
      class="flex h-[22px] cursor-default items-center gap-1 px-2"
      :class="
        row.kind === 'file' &&
        row.file &&
        changes.selectedPaths.includes(row.file.path) &&
        changes.selectedSection === row.section
          ? 'bg-accent'
          : 'hover:bg-accent/50'
      "
      tabindex="0"
      @click="onClick(row, $event)"
      @dblclick="onDblClick(row)"
      @contextmenu="onContext(row, $event)"
      @keydown="onKeydown(row, $event)"
    >
      <template v-if="row.kind === 'header'">
        <span
          class="text-foreground"
          :class="row.active ? 'font-bold' : 'font-medium'"
        >
          {{ row.label }}
        </span>
        <span class="text-muted-foreground">({{ row.count }})</span>
      </template>
      <template v-else-if="row.file">
        <input
          v-if="showCheckbox(row)"
          type="checkbox"
          class="accent-foreground"
          :checked="changes.checkedPaths.includes(row.file.path)"
          @click.stop
          @change="changes.toggleChecked(row.file.path)"
        />
        <span class="truncate" :class="statusClass(row.file.kind)">
          {{ displayName(row.file) }}
        </span>
      </template>
    </div>
    <div v-if="isEmpty" class="px-3 py-6 text-xs text-muted-foreground">
      No local changes
    </div>
  </div>
</template>
