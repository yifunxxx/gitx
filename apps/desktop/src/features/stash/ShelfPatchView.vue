<script setup lang="ts">
import { shelfPatchTheme } from "@/features/editor/editorThemes";
import { onBeforeUnmount, ref, watch } from "vue";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { editorChrome } from "@/features/editor/editorChrome";
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
          ...editorChrome({ caret: false }),
          patchHighlights,
          shelfPatchTheme,
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
