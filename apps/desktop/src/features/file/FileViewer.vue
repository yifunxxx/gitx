<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { fileChangeHighlights } from "./fileChangeHighlights";
import { useFileViewerStore } from "@/stores/fileViewerStore";

const props = defineProps<{ tabId: string }>();
const store = useFileViewerStore();

const tab = computed(() => store.tabs.find((t) => t.id === props.tabId));
const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;

function release() {
  view?.destroy();
  view = null;
}

function mount() {
  release();
  if (!host.value || !tab.value || tab.value.loading) return;
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
          "&": {
            height: "100%",
            fontSize: "12.5px",
            backgroundColor: "var(--color-background)",
            color: "var(--color-foreground)",
          },
          ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono, monospace)" },
          ".cm-gutters": {
            backgroundColor: "var(--color-background)",
            color: "var(--color-muted-foreground)",
            borderRight: "1px solid var(--color-border)",
          },
          ".cm-cursor": { borderLeftColor: "var(--color-foreground)" },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
            backgroundColor: "var(--color-accent)",
          },
          ".cm-diff-insert": {
            backgroundColor: "color-mix(in oklab, var(--color-success, #16a34a) 22%, transparent)",
          },
          ".cm-file-modified": {
            backgroundColor: "color-mix(in oklab, var(--color-warning, #ca8a04) 22%, transparent)",
          },
        }),
        fileChangeHighlights(hunks),
      ],
    }),
  });
}

onBeforeUnmount(release);
watch(
  [
    host,
    () => tab.value?.id,
    () => tab.value?.text,
    () => tab.value?.hunks,
    () => tab.value?.loading,
    () => tab.value?.editable,
  ],
  mount,
  // Loading replaces the host with v-if; wait until Vue has mounted its replacement.
  { flush: "post" },
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
