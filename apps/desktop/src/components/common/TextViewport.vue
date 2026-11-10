<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, isolateHistory } from "@codemirror/commands";
import { parseSource, restoreEndings, sourceExtensions, sourceText } from "./preservedText";

const props = withDefaults(
  defineProps<{
    text: string;
    label: string;
    editable?: boolean;
    disabled?: boolean;
  }>(),
  { editable: false, disabled: false },
);
const emit = defineEmits<{ "update:text": [text: string] }>();
const host = ref<HTMLElement | null>(null);
const access = new Compartment();
let view: EditorView | undefined;
let source = props.text;
let external = false;
let resize: ResizeObserver | undefined;

function accessExtensions() {
  return [
    EditorState.readOnly.of(!props.editable || props.disabled),
    EditorView.editable.of(props.editable && !props.disabled),
    EditorView.contentAttributes.of({
      "aria-label": props.label,
      "aria-readonly": String(!props.editable || props.disabled),
      "aria-disabled": String(props.disabled),
      tabindex: "0",
    }),
  ];
}
onMounted(() => {
  if (!host.value) return;
  source = props.text;
  const parsed = parseSource(source);
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: parsed.doc,
      extensions: [
        sourceExtensions(parsed),
        access.of(accessExtensions()),
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((update) => {
          // Scrolling, selection and resizing never serialize the full document.
          if (!update.docChanged || external) return;
          source = sourceText(update.state);
          emit("update:text", source);
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "12px", backgroundColor: "transparent" },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "var(--font-mono, monospace)",
            lineHeight: "20px",
          },
          ".cm-content": { padding: "8px 0" },
          ".cm-gutters": {
            backgroundColor: "transparent",
            color: "var(--color-muted-foreground)",
            borderRight: "1px solid var(--color-border)",
          },
          ".cm-cursor": { borderLeftColor: "var(--color-foreground)" },
          "&.cm-focused": { outline: "none" },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
            backgroundColor: "var(--color-accent)",
          },
        }),
      ],
    }),
  });
  resize = new ResizeObserver(() => view?.requestMeasure());
  resize.observe(host.value);
});
watch(
  () => props.text,
  (text) => {
    if (!view || text === source) return;
    source = text;
    const parsed = parseSource(text);
    const selection = view.state.selection.main;
    external = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: parsed.doc },
        effects: restoreEndings.of(parsed.endings),
        selection: EditorSelection.range(
          Math.min(selection.anchor, parsed.doc.length),
          Math.min(selection.head, parsed.doc.length),
        ),
        annotations: isolateHistory.of("full"),
      });
    } finally {
      external = false;
    }
  },
);
watch(
  () => [props.editable, props.disabled, props.label],
  () => {
    view?.dispatch({ effects: access.reconfigure(accessExtensions()) });
  },
);
onBeforeUnmount(() => {
  resize?.disconnect();
  view?.destroy();
  view = undefined;
});
</script>

<template>
  <div ref="host" class="min-h-0 min-w-0 overflow-hidden" data-text-viewport />
</template>
