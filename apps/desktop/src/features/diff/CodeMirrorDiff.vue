<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { EditorView, lineNumbers, Decoration, type DecorationSet } from "@codemirror/view";
import type { DiffHunk } from "@/lib/backend";

const props = defineProps<{
  text: string;
  hunks: DiffHunk[];
  side: "left" | "right" | "unified";
  unified?: boolean;
}>();

const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;

const insertMark = Decoration.line({ class: "cm-diff-insert" });
const deleteMark = Decoration.line({ class: "cm-diff-delete" });

function buildDecorations(doc: string, hunks: DiffHunk[], side: string, unified: boolean): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (!doc) return builder.finish();

  if (unified) {
    const lines = doc.split("\n");
    let pos = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const from = pos;
      if (line.startsWith("+")) builder.add(from, from, insertMark);
      else if (line.startsWith("-")) builder.add(from, from, deleteMark);
      pos += line.length + 1;
    }
    return builder.finish();
  }

  // Side-by-side: mark lines covered by hunks using new/old line numbers.
  const changed = new Set<number>();
  for (const h of hunks) {
    if (side === "left") {
      for (const line of h.lines) {
        if (line.startsWith("-") || line.startsWith(" ")) {
          /* counted below via old_start */
        }
      }
      let n = h.oldStart;
      for (const line of h.lines) {
        if (line.startsWith("+")) continue;
        if (line.startsWith("-")) changed.add(n);
        n += 1;
      }
    } else {
      let n = h.newStart;
      for (const line of h.lines) {
        if (line.startsWith("-")) continue;
        if (line.startsWith("+")) changed.add(n);
        n += 1;
      }
    }
  }

  const lines = doc.split("\n");
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    if (changed.has(lineNo)) {
      builder.add(pos, pos, side === "left" ? deleteMark : insertMark);
    }
    pos += (lines[i]?.length ?? 0) + 1;
  }
  return builder.finish();
}

function unifiedText(hunks: DiffHunk[]): string {
  return hunks.map((h) => `${h.header}\n${h.lines.join("\n")}`).join("\n");
}

function mount() {
  if (!host.value) return;
  view?.destroy();
  const content =
    props.unified || props.side === "unified" ? unifiedText(props.hunks) : props.text;
  const deco = buildDecorations(
    content,
    props.hunks,
    props.side,
    !!(props.unified || props.side === "unified"),
  );
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        EditorView.editable.of(false),
        EditorView.theme({
          "&": { height: "100%", fontSize: "12px" },
          ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.45" },
          ".cm-content": { caretColor: "transparent" },
          ".cm-diff-insert": { backgroundColor: "rgb(var(--diff-insert-bg) / 1)" },
          ".cm-diff-delete": { backgroundColor: "rgb(var(--diff-delete-bg) / 1)" },
        }),
        EditorView.decorations.of(deco),
      ],
    }),
  });
}

onMounted(mount);
onBeforeUnmount(() => view?.destroy());
watch(
  () => [props.text, props.hunks, props.side, props.unified] as const,
  () => mount(),
);
</script>

<template>
  <div ref="host" class="h-full min-h-0 overflow-hidden" />
</template>
