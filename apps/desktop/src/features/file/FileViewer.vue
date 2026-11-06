<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { EditorView, lineNumbers, Decoration, type DecorationSet } from "@codemirror/view";
import type { DiffHunk } from "@/lib/backend";
import { useFileViewerStore } from "@/stores/fileViewerStore";

const props = defineProps<{ tabId: string }>();
const store = useFileViewerStore();

const tab = computed(() => store.tabs.find((t) => t.id === props.tabId));
const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;

const insertMark = Decoration.line({ class: "cm-diff-insert" });
const modifyMark = Decoration.line({ class: "cm-file-modified" });

function changedLines(hunks: DiffHunk[]): { added: Set<number>; modified: Set<number> } {
  const added = new Set<number>();
  const modified = new Set<number>();
  for (const h of hunks) {
    let n = h.newStart;
    for (const line of h.lines) {
      if (line.startsWith("-")) continue;
      if (line.startsWith("+")) {
        // Pure adds vs replacements: if hunk also has deletes nearby, treat as modified.
        const hasDelete = h.lines.some((l) => l.startsWith("-"));
        if (hasDelete) modified.add(n);
        else added.add(n);
      }
      n += 1;
    }
  }
  return { added, modified };
}

function buildDecorations(doc: string, hunks: DiffHunk[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (!doc) return builder.finish();
  const { added, modified } = changedLines(hunks);
  const lines = doc.split("\n");
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    if (added.has(lineNo)) builder.add(pos, pos, insertMark);
    else if (modified.has(lineNo)) builder.add(pos, pos, modifyMark);
    pos += (lines[i]?.length ?? 0) + 1;
  }
  return builder.finish();
}

function mount() {
  if (!host.value || !tab.value) return;
  view?.destroy();
  const text = tab.value.text;
  const hunks = tab.value.hunks;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        EditorView.editable.of(!!tab.value.editable),
        EditorView.theme({
          "&": { height: "100%", fontSize: "12.5px" },
          ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, monospace" },
          ".cm-diff-insert": { backgroundColor: "color-mix(in oklab, var(--color-success, #16a34a) 22%, transparent)" },
          ".cm-file-modified": { backgroundColor: "color-mix(in oklab, var(--color-warning, #ca8a04) 22%, transparent)" },
        }),
        EditorView.decorations.of((v) => buildDecorations(v.state.doc.toString(), hunks)),
      ],
    }),
  });
}

onMounted(mount);
onBeforeUnmount(() => view?.destroy());
watch(
  () => [tab.value?.text, tab.value?.hunks, tab.value?.loading],
  () => {
    if (!tab.value?.loading) mount();
  },
);
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col">
    <div class="flex h-8 items-center gap-2 border-b bg-dbx-chrome px-2 text-xs">
      <span class="font-medium">{{ tab.path }}</span>
      <span class="text-muted-foreground">vs HEAD</span>
    </div>
    <div v-if="tab.loading" class="p-4 text-xs text-muted-foreground">Loading…</div>
    <div v-else ref="host" class="min-h-0 flex-1 overflow-hidden" />
  </div>
</template>

<style>
.cm-file-modified {
  border-left: 2px solid #ca8a04;
}
.cm-diff-insert {
  border-left: 2px solid #16a34a;
}
</style>
