<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { useConsoleStore, type ConsoleEntry } from "@/stores/consoleStore";

const consoleStore = useConsoleStore();
const host = ref<HTMLElement | null>(null);
const replaceMarks = StateEffect.define<DecorationSet>();
const marks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(replaceMarks)) return effect.value;
    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});
let view: EditorView | undefined;
let rendered: { id: string; length: number }[] = [];
let frame = 0;
const entryText = (entry: ConsoleEntry) => `${entry.stream}  ${entry.line}\n`;

function update() {
  frame = 0;
  if (!view) return;
  const entries = consoleStore.lines;
  // Preserve the existing document/selection while appending or evicting old log
  // entries. CodeMirror measures and paints only its visible wrapped lines.
  const retainedAt = entries.length
    ? rendered.findIndex((entry) => entry.id === entries[0]!.id)
    : -1;
  let changes;
  if (retainedAt < 0) {
    changes = [{ from: 0, to: view.state.doc.length, insert: entries.map(entryText).join("") }];
  } else {
    const removedLength = rendered
      .slice(0, retainedAt)
      .reduce((sum, entry) => sum + entry.length, 0);
    const retained = rendered.length - retainedAt;
    changes = [
      ...(removedLength ? [{ from: 0, to: removedLength, insert: "" }] : []),
      { from: view.state.doc.length, insert: entries.slice(retained).map(entryText).join("") },
    ];
  }
  const ranges = new RangeSetBuilder<Decoration>();
  let position = 0;
  rendered = entries.map((entry) => {
    const text = entryText(entry);
    const decoration = Decoration.line({ class: `console-${entry.stream}` });
    ranges.add(position, position, decoration);
    for (let i = text.indexOf("\n"); i >= 0 && i < text.length - 1; i = text.indexOf("\n", i + 1)) {
      ranges.add(position + i + 1, position + i + 1, decoration);
    }
    position += text.length;
    return { id: entry.id, length: text.length };
  });
  view.dispatch({ changes, effects: replaceMarks.of(ranges.finish()) });
}
function schedule() {
  if (!frame && view) frame = requestAnimationFrame(update);
}
watch(
  () => [consoleStore.lines.length, consoleStore.lines[0]?.id, consoleStore.lines.at(-1)?.id],
  schedule,
  { flush: "post" },
);
onMounted(() => {
  if (!host.value) return;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        marks,
        EditorView.contentAttributes.of({ "aria-label": "Git console", tabindex: "0" }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "11px" },
          ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, monospace" },
          ".cm-content": { padding: "8px" },
          ".console-cmd": { color: "var(--color-info)" },
          ".console-stderr": { color: "var(--color-destructive)" },
        }),
      ],
    }),
  });
  update();
});
onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame);
  view?.destroy();
  view = undefined;
});
</script>

<template>
  <div class="relative min-h-0 flex-1">
    <div ref="host" class="h-full overflow-hidden" />
    <div
      v-if="!consoleStore.lines.length"
      class="pointer-events-none absolute left-2 top-2 text-[11px] text-muted-foreground"
    >
      Console is empty. Git commands appear here as you work.
    </div>
  </div>
</template>
