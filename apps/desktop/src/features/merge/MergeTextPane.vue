<script setup lang="ts">
import { mergeTheme } from "@/features/editor/editorThemes";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, historyKeymap, redo } from "@codemirror/commands";
import { editorChrome } from "@/features/editor/editorChrome";
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
    ...editorChrome({ caret: !!props.editable && !props.disabled }),
    props.extensions ?? [],
    EditorView.updateListener.of((update) => {
      if (props.editable) emit("change", props.ownerId, update.state, update.docChanged);
    }),
    mergeTheme,
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
