<script setup lang="ts" generic="T extends PathTreeFileMeta">
import { computed, ref } from "vue";
import { ChevronDown, ChevronRight } from "@lucide/vue";
import {
  buildPathTree,
  flattenPathTree,
  type PathTreeFileMeta,
  type PathTreeNode,
} from "@/lib/path-tree/buildPathTree";
import FileTypeIcon from "./FileTypeIcon.vue";
import VirtualList from "@/components/common/VirtualList.vue";
import { markContextHandled } from "@/lib/contextMenu";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    files: T[];
    /** Status/color class for a file row. */
    statusClass?: (file: T) => string;
    selectedPath?: string | null;
    emptyText?: string;
  }>(),
  {
    statusClass: () => "text-foreground",
    selectedPath: null,
    emptyText: undefined,
  },
);

const resolvedEmpty = computed(() => props.emptyText ?? t("empty.noFiles"));

const emit = defineEmits<{
  select: [file: T];
  open: [file: T];
  context: [payload: { file: T; x: number; y: number }];
}>();

const ROW_H = 22;
/** Explicit expand/collapse overrides; default = expanded. */
const expanded = ref<Set<string>>(new Set());

const tree = computed(() => buildPathTree(props.files));
const rows = computed(() => flattenPathTree(tree.value, expanded.value, true));

function toggleFolder(node: PathTreeNode<T>) {
  const next = new Set(expanded.value);
  const currentlyOpen = next.has(`!${node.id}`) ? false : next.has(node.id) ? true : true;
  if (currentlyOpen) {
    next.delete(node.id);
    next.add(`!${node.id}`);
  } else {
    next.delete(`!${node.id}`);
    next.add(node.id);
  }
  expanded.value = next;
}

function onRowClick(node: PathTreeNode<T>) {
  if (node.kind === "folder" && node.children?.length) {
    toggleFolder(node);
    return;
  }
  if (node.file) emit("select", node.file);
}

function onRowDblClick(node: PathTreeNode<T>) {
  if (node.file) emit("open", node.file);
  else if (node.kind === "folder") toggleFolder(node);
}

function onContext(node: PathTreeNode<T>, e: MouseEvent) {
  if (!node.file) return;
  markContextHandled(e);
  emit("context", { file: node.file, x: e.clientX, y: e.clientY });
}

function labelFor(node: PathTreeNode<T>) {
  if (node.file?.origPath) {
    const from = node.file.origPath.replace(/\\/g, "/").split("/").pop();
    return `${from} → ${node.name}`;
  }
  return node.name;
}
</script>

<template>
  <div v-if="!files.length" class="min-h-0 flex-1 px-3 py-4 text-xs text-muted-foreground">
    {{ resolvedEmpty }}
  </div>
  <VirtualList
    v-else
    class="text-[12.5px]"
    :items="rows"
    :item-height="ROW_H"
    :get-key="(row) => row.node.id"
  >
    <template #default="{ item: row }">
      <div
        class="flex h-[22px] cursor-pointer items-center gap-0.5 pr-2 hover:bg-accent/50"
        :class="selectedPath && row.node.file?.path === selectedPath ? 'bg-accent' : ''"
        :style="{ paddingLeft: `${8 + row.node.depth * 12}px` }"
        @click="onRowClick(row.node)"
        @dblclick="onRowDblClick(row.node)"
        @contextmenu="onContext(row.node, $event)"
      >
        <button
          v-if="row.node.kind === 'folder' && row.node.children?.length"
          type="button"
          class="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center text-muted-foreground"
          @click.stop="toggleFolder(row.node)"
        >
          <ChevronDown v-if="row.expanded" class="h-3 w-3" />
          <ChevronRight v-else class="h-3 w-3" />
        </button>
        <span v-else class="inline-block h-4 w-4 shrink-0" />
        <FileTypeIcon
          :name="row.node.name"
          :kind="row.node.kind"
          :expanded="row.expanded"
        />
        <span
          class="min-w-0 truncate"
          :class="row.node.file ? statusClass(row.node.file) : 'text-foreground'"
        >
          {{ labelFor(row.node) }}
        </span>
      </div>
    </template>
  </VirtualList>
</template>
