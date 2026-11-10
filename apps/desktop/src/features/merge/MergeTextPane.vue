<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, historyKeymap, redo } from "@codemirror/commands";
import { mergeViewConfig } from "./mergeDocument";

const props = defineProps<{
  state: EditorState;
  ownerId: string;
  label: string;
  editable?: boolean;
  disabled?: boolean;
  extensions?: Extension;
}>();
const emit = defineEmits<{ change: [id: string, state: EditorState, docChanged: boolean] }>();
const host = ref<HTMLElement | null>(null);
let view: EditorView | undefined;
let resize: ResizeObserver | undefined;
function config() {
  return [
    EditorState.readOnly.of(!props.editable || !!props.disabled),
    EditorView.editable.of(!!props.editable && !props.disabled),
    EditorView.contentAttributes.of({
      "aria-label": props.label,
      "aria-readonly": String(!props.editable || !!props.disabled),
    }),
    lineNumbers(),
    keymap.of([
      { key: "Mod-Shift-z", run: redo, preventDefault: true },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    props.extensions ?? [],
    EditorView.updateListener.of((update) => {
      if (props.editable) emit("change", props.ownerId, update.state, update.docChanged);
    }),
    EditorView.theme({
      "&": { height: "100%", fontSize: "12px", backgroundColor: "transparent" },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: "var(--font-mono, monospace)",
        lineHeight: "22px",
      },
      ".cm-content": { padding: "8px 0" },
      ".cm-gutters": {
        backgroundColor: "var(--color-background)",
        color: "var(--color-muted-foreground)",
        borderColor: "var(--color-border)",
      },
      ".cm-cursor": { borderLeftColor: "var(--color-foreground)" },
      "&.cm-focused": { outline: "none" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: "var(--color-accent)",
      },
      ".cm-merge-pending": {
        backgroundColor: "var(--diff-conflict-bg, #c8903026)",
        boxShadow: "inset 3px 0 #c89030",
      },
      ".cm-merge-accepted": {
        backgroundColor: "var(--diff-added-bg, #40945520)",
        boxShadow: "inset 3px 0 #409455",
      },
      ".cm-merge-ignored": { opacity: "0.55" },
      ".cm-merge-manual": {
        backgroundColor: "var(--diff-conflict-bg, #c8903026)",
        boxShadow: "inset 3px 0 #6c9eff",
      },
      ".cm-merge-actions": { minWidth: "48px", color: "var(--color-foreground)" },
      ".cm-merge-actions .cm-gutterElement": { padding: "0 2px" },
      ".merge-actions": { display: "inline-flex", gap: "2px", verticalAlign: "top" },
      ".merge-action": {
        width: "21px",
        height: "21px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "3px",
        cursor: "pointer",
        color: "var(--color-foreground)",
        backgroundColor: "var(--color-muted)",
        border: "1px solid var(--color-border)",
        padding: "0",
        fontSize: "15px",
      },
      ".merge-action:hover:not(:disabled)": { backgroundColor: "var(--color-accent)" },
      ".merge-action:focus-visible": {
        outline: "2px solid var(--color-ring)",
        outlineOffset: "1px",
      },
      ".merge-action:disabled": { cursor: "default", opacity: "0.45" },
      ".merge-action[data-decided=accept]": { color: "#409455" },
    }),
  ];
}
onMounted(() => {
  if (!host.value) return;
  view = new EditorView({
    parent: host.value,
    state: props.state.update({ effects: mergeViewConfig.reconfigure(config()) }).state,
  });
  resize = new ResizeObserver(() => view?.requestMeasure());
  resize.observe(host.value);
});
watch(
  () => props.state,
  (state) => {
    if (!view || state === view.state) return;
    view.setState(state.update({ effects: mergeViewConfig.reconfigure(config()) }).state);
  },
);
watch(
  () => [props.label, props.disabled, props.extensions],
  () => {
    view?.dispatch({ effects: mergeViewConfig.reconfigure(config()) });
  },
);
defineExpose({ getView: () => view });
onBeforeUnmount(() => {
  if (view && props.editable) {
    // Retain undo data without retaining component callbacks or detached DOM.
    emit(
      "change",
      props.ownerId,
      view.state.update({ effects: mergeViewConfig.reconfigure([]) }).state,
      false,
    );
  }
  resize?.disconnect();
  view?.destroy();
  view = undefined;
});
</script>

<template>
  <div ref="host" class="min-h-0 min-w-0 flex-1 overflow-hidden" data-merge-pane />
</template>
