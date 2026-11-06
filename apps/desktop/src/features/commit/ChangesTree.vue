<script setup lang="ts">
import { computed } from "vue";
import type { FileChange } from "@/lib/backend";
import { useChangesStore, type ChangesSection } from "@/stores/changesStore";
import { statusClass } from "./statusColor";

const changes = useChangesStore();

const emit = defineEmits<{
  openDiff: [path: string, section: ChangesSection];
  context: [payload: { path: string; section: ChangesSection; x: number; y: number }];
}>();

type Row = {
  kind: "header" | "file";
  section: ChangesSection;
  label: string;
  file?: FileChange;
  count?: number;
};

const rows = computed<Row[]>(() => {
  const out: Row[] = [];
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
  out.push({
    kind: "header",
    section: "unversioned",
    label: "Unversioned Files",
    count: changes.unversioned.length,
  });
  for (const f of changes.unversioned) {
    out.push({ kind: "file", section: "unversioned", label: f.path, file: f });
  }
  return out;
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

function onContext(row: Row, e: MouseEvent) {
  if (row.kind !== "file" || !row.file) return;
  e.preventDefault();
  if (!changes.selectedPaths.includes(row.file.path)) {
    changes.select(row.file.path, row.section, false);
  }
  emit("context", { path: row.file.path, section: row.section, x: e.clientX, y: e.clientY });
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
      @click="onClick(row, $event)"
      @dblclick="onDblClick(row)"
      @contextmenu="onContext(row, $event)"
    >
      <template v-if="row.kind === 'header'">
        <span class="font-medium text-foreground">{{ row.label }}</span>
        <span class="text-muted-foreground">({{ row.count }})</span>
      </template>
      <template v-else-if="row.file">
        <span class="truncate" :class="statusClass(row.file.kind)">
          {{ displayName(row.file) }}
        </span>
      </template>
    </div>
    <div
      v-if="!changes.staged.length && !changes.unstaged.length && !changes.unversioned.length"
      class="px-3 py-6 text-xs text-muted-foreground"
    >
      No local changes
    </div>
  </div>
</template>
