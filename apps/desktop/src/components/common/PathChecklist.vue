<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronDown, ChevronRight, List, ListTree } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import VirtualList from "@/components/common/VirtualList.vue";
import IndeterminateCheckbox from "@/components/common/IndeterminateCheckbox.vue";
import FileTypeIcon from "@/components/files/FileTypeIcon.vue";
import { buildPathTree, type PathTreeNode } from "@/lib/path-tree/buildPathTree";

export type PathChecklistItem = {
  path: string;
  origPath?: string | null;
  status?: string;
};

const props = withDefaults(
  defineProps<{
    files: PathChecklistItem[];
    modelValue: string[];
    disabled?: boolean;
  }>(),
  { disabled: false },
);
const emit = defineEmits<{ "update:modelValue": [paths: string[]] }>();
const { t } = useI18n();
const query = ref("");
const treeMode = ref(false);
const collapsed = ref(new Set<string>());
const currentKey = ref<string | null>(null);
const list = ref<{
  el: HTMLElement | null;
  scrollToIndex: (index: number) => void;
  isIndexVisible: (index: number) => boolean;
} | null>(null);
const selected = computed(() => new Set(props.modelValue));
const filtered = computed(() => {
  const term = query.value.toLocaleLowerCase();
  if (!term) return props.files;
  return props.files.filter((file) =>
    `${file.path}\n${file.origPath ?? ""}`.toLocaleLowerCase().includes(term),
  );
});

type Row = {
  key: string;
  path: string;
  name: string;
  file?: PathChecklistItem;
  folder: boolean;
  depth: number;
  parent: string | null;
  expanded: boolean;
};
type TreeEntry = { row: Row; start: number; end: number };

// Each folder owns a range in one shared file array. Selection changes build
// one prefix count; scrolling does not walk every descendant for each row.
const treeModel = computed(() => {
  const entries: TreeEntry[] = [];
  const paths: string[] = [];
  const roots = buildPathTree(filtered.value);
  const represented = new Set<string>();
  const childrenByPath = new Map<string, PathTreeNode<PathChecklistItem>[]>([["", roots]]);
  const pending = roots.slice();
  while (pending.length) {
    const node = pending.pop()!;
    if (node.file) represented.add(node.file.path);
    if (node.children) {
      childrenByPath.set(node.id, node.children);
      for (const child of node.children) pending.push(child);
    }
  }
  // A deleted file can be replaced by a directory with the same name. The
  // shared display tree keeps the directory; the picker must also retain the
  // old file as an independently selectable sibling outside that folder's range.
  const repaired = new Set<PathTreeNode<PathChecklistItem>[]>();
  for (const file of filtered.value) {
    if (represented.has(file.path)) continue;
    const parts = file.path.replace(/\\/g, "/").split("/").filter(Boolean);
    const name = parts.pop() ?? file.path;
    const siblings = childrenByPath.get(parts.join("/")) ?? roots;
    siblings.push({
      id: file.path,
      name,
      kind: /[\\/]$/.test(file.path) ? "folder" : "file",
      depth: parts.length,
      file,
    });
    represented.add(file.path);
    repaired.add(siblings);
  }
  for (const siblings of repaired)
    siblings.sort((a, b) =>
      a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : a.name.localeCompare(b.name),
    );
  type Visit = { node: PathTreeNode<PathChecklistItem>; parent: string | null };
  const stack: (Visit | { exit: TreeEntry })[] = roots
    .slice()
    .reverse()
    .map((node) => ({ node, parent: null }));
  while (stack.length) {
    const visit = stack.pop()!;
    if ("exit" in visit) {
      visit.exit.end = paths.length;
      continue;
    }
    const { node, parent } = visit;
    const folder = !!node.children?.length;
    const key = `${folder ? "folder" : "file"}:${node.id}`;
    const entry: TreeEntry = {
      row: {
        key,
        path: node.id,
        name: node.name,
        file: node.file,
        folder,
        depth: node.depth,
        parent,
        expanded: false,
      },
      start: paths.length,
      end: 0,
    };
    entries.push(entry);
    if (node.file) paths.push(node.file.path);
    stack.push({ exit: entry });
    for (let i = (node.children?.length ?? 0) - 1; i >= 0; i--)
      stack.push({ node: node.children![i]!, parent: key });
  }
  return { entries, paths, byKey: new Map(entries.map((entry) => [entry.row.key, entry])) };
});
const selectedPrefix = computed(() => {
  const counts = [0];
  for (const path of treeModel.value.paths)
    counts.push(counts[counts.length - 1]! + (selected.value.has(path) ? 1 : 0));
  return counts;
});
const rows = computed<Row[]>(() => {
  if (!treeMode.value)
    return filtered.value.map((file) => ({
      key: `file:${file.path}`,
      path: file.path,
      name: file.path,
      file,
      folder: false,
      depth: 0,
      parent: null,
      expanded: false,
    }));
  const visible: Row[] = [];
  let hiddenBelow = Infinity;
  for (const { row } of treeModel.value.entries) {
    if (row.depth > hiddenBelow) continue;
    hiddenBelow = Infinity;
    const expanded = row.folder && !collapsed.value.has(row.key);
    visible.push({ ...row, expanded });
    if (row.folder && !expanded) hiddenBelow = row.depth;
  }
  return visible;
});
const rowIndices = computed(() => new Map(rows.value.map((row, index) => [row.key, index])));
const currentIndex = computed(() => rowIndices.value.get(currentKey.value ?? "") ?? 0);
const currentVisible = computed(() => list.value?.isIndexVisible(currentIndex.value) ?? true);
watch(query, () => {
  // Search results must remain discoverable inside previously collapsed folders.
  collapsed.value = new Set();
  list.value?.scrollToIndex(0);
});
watch(
  rows,
  (items) => {
    if (!items.some((row) => row.key === currentKey.value))
      currentKey.value = items[0]?.key ?? null;
  },
  { immediate: true },
);

watch(
  () => props.files.map((file) => file.path).join("\0"),
  () => {
    const allowed = new Set(props.files.map((file) => file.path));
    const next = props.modelValue.filter((path) => allowed.has(path));
    if (next.length !== props.modelValue.length) emit("update:modelValue", next);
  },
);

function setSelected(paths: Iterable<string>) {
  emit("update:modelValue", [...new Set(paths)]);
}
function checkState(row: Row): boolean | "mixed" {
  if (!row.folder) return selected.value.has(row.path);
  const range = treeModel.value.byKey.get(row.key)!;
  const count = selectedPrefix.value[range.end]! - selectedPrefix.value[range.start]!;
  return count === 0 ? false : count === range.end - range.start ? true : "mixed";
}
function toggle(row: Row) {
  if (props.disabled) return;
  const next = new Set(selected.value);
  const range = row.folder ? treeModel.value.byKey.get(row.key) : undefined;
  const paths = range ? treeModel.value.paths.slice(range.start, range.end) : [row.path];
  const remove = checkState(row) === true;
  for (const path of paths) {
    if (remove) next.delete(path);
    else next.add(path);
  }
  setSelected(next);
}
async function focusRow(index: number) {
  const target = Math.max(0, Math.min(rows.value.length - 1, index));
  const row = rows.value[target];
  if (!row || props.disabled) return;
  currentKey.value = row.key;
  list.value?.scrollToIndex(target);
  await nextTick();
  if (rows.value[target]?.key !== row.key || currentKey.value !== row.key || props.disabled) return;
  list.value?.el?.querySelector<HTMLInputElement>(`[data-file-index="${target}"]`)?.focus();
}
async function toggleFolder(row: Row) {
  if (props.disabled || !row.folder) return;
  const next = new Set(collapsed.value);
  if (row.expanded) next.add(row.key);
  else next.delete(row.key);
  collapsed.value = next;
  await focusRow(rows.value.findIndex((item) => item.key === row.key));
}
function toggleMode() {
  if (props.disabled) return;
  treeMode.value = !treeMode.value;
  currentKey.value = rows.value[0]?.key ?? null;
  list.value?.scrollToIndex(0);
}
function selectVisible() {
  if (props.disabled) return;
  const next = new Set(selected.value);
  for (const file of filtered.value) next.add(file.path);
  setSelected(next);
}
function clearSelection() {
  if (props.disabled) return;
  setSelected([]);
}
async function moveFocus(event: KeyboardEvent, index: number) {
  if (
    props.disabled ||
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return;
  const key = event.key;
  const row = rows.value[index];
  if (treeMode.value && row && (key === "ArrowLeft" || key === "ArrowRight")) {
    event.preventDefault();
    event.stopPropagation();
    if (key === "ArrowLeft") {
      if (row.folder && row.expanded) await toggleFolder(row);
      else if (row.parent) await focusRow(rows.value.findIndex((item) => item.key === row.parent));
    } else if (row.folder) {
      if (!row.expanded) await toggleFolder(row);
      else await focusRow(index + 1);
    }
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return;
  event.preventDefault();
  event.stopPropagation();
  const next =
    key === "Home"
      ? 0
      : key === "End"
        ? rows.value.length - 1
        : index + (key === "ArrowDown" ? 1 : -1);
  await focusRow(next);
}
</script>

<template>
  <div class="flex min-h-0 flex-col gap-2">
    <input
      v-model="query"
      type="search"
      :aria-label="t('rewrite.filterFiles')"
      :placeholder="t('rewrite.filterFiles')"
      :disabled="disabled"
      class="h-8 w-full rounded-md border bg-background px-2 text-xs"
    />
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <Button
        type="button"
        size="sm"
        variant="outline"
        :disabled="disabled"
        :aria-pressed="treeMode"
        :aria-label="
          t(treeMode ? 'commitTw.listModeToggleTipTree' : 'commitTw.listModeToggleTipFlat')
        "
        :title="t(treeMode ? 'commitTw.listModeToggleTipTree' : 'commitTw.listModeToggleTipFlat')"
        data-list-mode
        @click="toggleMode"
      >
        <ListTree v-if="treeMode" class="h-3.5 w-3.5" />
        <List v-else class="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        :disabled="disabled || !filtered.length"
        @click="selectVisible"
        >{{ t("rewrite.selectVisible") }}</Button
      >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        :disabled="disabled || !selected.size"
        @click="clearSelection"
        >{{ t("rewrite.clearSelection") }}</Button
      >
      <span role="status" class="ml-auto text-muted-foreground">{{
        t("rewrite.selectedFiles", { selected: selected.size, total: files.length })
      }}</span>
    </div>
    <div
      class="flex h-[min(30vh,280px)] min-h-[96px] shrink-0 flex-col rounded-md border"
      :role="treeMode ? 'tree' : undefined"
      :aria-label="treeMode ? t('commitTw.changesTree') : undefined"
      :aria-multiselectable="treeMode ? true : undefined"
      :tabindex="treeMode && !disabled && !currentVisible ? 0 : undefined"
      @focus.self="focusRow(currentIndex)"
    >
      <VirtualList
        ref="list"
        :items="rows"
        :item-height="24"
        :get-key="(row: Row) => row.key"
        preserve-scroll-anchor
      >
        <template #default="{ item: row, index }">
          <div
            class="flex h-full cursor-pointer items-center gap-1 px-2 text-xs hover:bg-accent focus-within:bg-accent"
            :title="row.file?.origPath ? `${row.file.origPath} → ${row.path}` : row.path"
            :style="treeMode ? { paddingLeft: `${8 + row.depth * 16}px` } : undefined"
            :role="treeMode ? 'treeitem' : undefined"
            :aria-level="treeMode ? row.depth + 1 : undefined"
            :aria-expanded="row.folder ? row.expanded : undefined"
            :aria-checked="treeMode ? checkState(row) : undefined"
            :data-path="row.path"
          >
            <template v-if="treeMode">
              <button
                v-if="row.folder"
                type="button"
                tabindex="-1"
                class="flex h-4 w-4 shrink-0 items-center justify-center"
                :aria-label="row.path"
                :aria-expanded="row.expanded"
                :disabled="disabled"
                @click="toggleFolder(row)"
              >
                <ChevronDown v-if="row.expanded" class="h-3 w-3" />
                <ChevronRight v-else class="h-3 w-3" />
              </button>
              <span v-else class="h-4 w-4 shrink-0" />
            </template>
            <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
              <IndeterminateCheckbox
                :checked="checkState(row) === true"
                :indeterminate="checkState(row) === 'mixed'"
                :disabled="disabled"
                :aria-label="row.file?.origPath ? `${row.file.origPath} → ${row.path}` : row.path"
                :tabindex="treeMode && currentKey !== row.key ? -1 : 0"
                :data-file-index="index"
                @change="toggle(row)"
                @keydown="moveFocus($event, index)"
                @focus="currentKey = row.key"
              />
              <FileTypeIcon
                v-if="treeMode"
                :name="row.name"
                :kind="row.folder || /[\\/]$/.test(row.path) ? 'folder' : 'file'"
                :expanded="row.expanded"
              />
              <span class="min-w-0 flex-1 truncate font-mono"
                ><template v-if="row.file?.origPath">{{ row.file.origPath }} → </template
                >{{ row.name }}</span
              >
              <span
                v-if="!row.folder && row.file?.status"
                class="shrink-0 font-mono text-[10px] text-muted-foreground"
                >{{ row.file.status }}</span
              >
            </label>
          </div>
        </template>
        <template #footer
          ><p v-if="!filtered.length" class="p-3 text-xs text-muted-foreground">
            {{ t("rewrite.noMatchingFiles") }}
          </p></template
        >
      </VirtualList>
    </div>
  </div>
</template>
