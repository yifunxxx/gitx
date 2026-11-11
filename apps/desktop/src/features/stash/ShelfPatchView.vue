<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { patchHighlights } from "./patchHighlights";

const props = defineProps<{ text: string; label: string }>();
const host = ref<HTMLElement | null>(null);
let view: EditorView | undefined;
let resize: ResizeObserver | undefined;
function release() {
  resize?.disconnect();
  view?.destroy();
  resize = undefined;
  view = undefined;
}
watch(
  [host, () => props.text, () => props.label],
  () => {
    release();
    if (!host.value) return;
    view = new EditorView({
      parent: host.value,
      state: EditorState.create({
        doc: props.text,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            "aria-label": props.label,
            "aria-readonly": "true",
            tabindex: "0",
          }),
          lineNumbers(),
          keymap.of(defaultKeymap),
          patchHighlights,
          EditorView.theme({
            "&": {
              height: "100%",
              fontSize: "12px",
              backgroundColor: "var(--color-background)",
              color: "var(--color-foreground)",
            },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "var(--font-mono, monospace)",
              lineHeight: "20px",
            },
            ".cm-gutters": {
              backgroundColor: "var(--color-background)",
              color: "var(--color-muted-foreground)",
              borderRight: "1px solid var(--color-border)",
            },
            ".cm-patch-added": {
              backgroundColor:
                "color-mix(in oklab, var(--color-success, #16a34a) 20%, transparent)",
            },
            ".cm-patch-removed": {
              backgroundColor: "color-mix(in oklab, var(--color-destructive) 18%, transparent)",
            },
            ".cm-patch-header": { color: "var(--color-muted-foreground)", fontWeight: "600" },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
              backgroundColor: "var(--color-accent)",
            },
          }),
        ],
      }),
    });
    resize = new ResizeObserver(() => view?.requestMeasure());
    resize.observe(host.value);
  },
  { flush: "post" },
);
onBeforeUnmount(release);
</script>

<template><div ref="host" class="min-h-0 min-w-0 overflow-hidden" data-shelf-patch /></template>
