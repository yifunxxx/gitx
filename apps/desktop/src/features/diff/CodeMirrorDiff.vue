<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  Decoration,
  gutter,
  GutterMarker,
  type DecorationSet,
} from "@codemirror/view";
import type { DiffHunk } from "@/lib/backend";
import {
  computeSideInlineRanges,
  computeUnifiedInlineRanges,
  type CharRange,
} from "./inlineDiff";
import { countHunkLines } from "./collapsedDiff";
import { contentFingerprint } from "./diffPaint";
import type { DiffPaneSnapshot, DiffPaneViewState } from "./diffViewState";

const props = defineProps<{
  text: string;
  hunks: DiffHunk[];
  side: "left" | "right" | "unified";
  unified?: boolean;
  /** Precomputed changed line set (1-based) for collapsed side-by-side. */
  changedLines?: Set<number> | null;
  /** Original line numbers for collapsed docs (index 0 = doc line 1). */
  lineMap?: number[] | null;
  /** Skip expensive char-level highlights for huge diffs. */
  enableInline?: boolean;
  /** Identifies this tab's content and display mode. */
  paintKey?: string;
  initialViewState?: DiffPaneViewState;
}>();

const emit = defineEmits<{
  scroll: [pos: { left: number; top: number }];
  saveViewState: [snapshot: DiffPaneSnapshot];
}>();

const hostRef = ref<HTMLDivElement | null>(null);

let view: EditorView | null = null;
let syncing = false;
let onScroll: (() => void) | null = null;
let mountToken = 0;
let lastFingerprint = "";
let resizeObserver: ResizeObserver | null = null;
let mountedKey = "";
let selectionVisible = false;
let detachSelection: (() => void) | null = null;

const insertLine = Decoration.line({ class: "cm-diff-insert" });
const deleteLine = Decoration.line({ class: "cm-diff-delete" });
const insertMark = Decoration.mark({ class: "cm-diff-word-insert" });
const deleteMark = Decoration.mark({ class: "cm-diff-word-delete" });

class ChangeGutter extends GutterMarker {
  constructor(private readonly kind: "insert" | "delete") {
    super();
  }
  eq(other: ChangeGutter) {
    return other.kind === this.kind;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className =
      this.kind === "insert" ? "cm-diff-gutter-insert" : "cm-diff-gutter-delete";
    return el;
  }
}

const insertGutter = new ChangeGutter("insert");
const deleteGutter = new ChangeGutter("delete");

function changedLineSet(
  hunks: DiffHunk[],
  side: string,
): { changed: Set<number>; kind: "insert" | "delete" } {
  if (props.changedLines) {
    return {
      changed: props.changedLines,
      kind: side === "left" ? "delete" : "insert",
    };
  }
  const changed = new Set<number>();
  if (side === "left") {
    for (const h of hunks) {
      let n = h.oldStart;
      for (const line of h.lines) {
        if (line.startsWith("+") || line.startsWith("\\")) continue;
        if (line.startsWith("-")) changed.add(n);
        n += 1;
      }
    }
    return { changed, kind: "delete" };
  }
  for (const h of hunks) {
    let n = h.newStart;
    for (const line of h.lines) {
      if (line.startsWith("-") || line.startsWith("\\")) continue;
      if (line.startsWith("+")) changed.add(n);
      n += 1;
    }
  }
  return { changed, kind: "insert" };
}

function shouldInline(hunks: DiffHunk[], doc: string): boolean {
  if (props.enableInline === false) return false;
  if (doc.length > 120_000) return false;
  if (countHunkLines(hunks) > 900) return false;
  return true;
}

function buildDecorations(
  doc: string,
  hunks: DiffHunk[],
  side: string,
  unified: boolean,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (!doc) return builder.finish();
  const lines = doc.split("\n");
  type Item = { from: number; to: number; deco: Decoration };
  const items: Item[] = [];
  const doInline = shouldInline(hunks, doc);

  if (unified) {
    let pos = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.startsWith("+")) items.push({ from: pos, to: pos, deco: insertLine });
      else if (line.startsWith("-")) items.push({ from: pos, to: pos, deco: deleteLine });
      pos += line.length + 1;
    }
    if (doInline) {
      const inline = computeUnifiedInlineRanges(hunks);
      pos = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        pushInline(
          items,
          pos,
          line,
          inline.get(i + 1),
          line.startsWith("-") ? deleteMark : insertMark,
        );
        pos += line.length + 1;
      }
    }
  } else {
    const { changed, kind } = changedLineSet(hunks, side);
    const lineMark = kind === "delete" ? deleteLine : insertLine;
    const wordMark = kind === "delete" ? deleteMark : insertMark;
    let pos = 0;
    for (let i = 0; i < lines.length; i++) {
      if (changed.has(i + 1)) items.push({ from: pos, to: pos, deco: lineMark });
      pos += (lines[i]?.length ?? 0) + 1;
    }
    if (doInline && !props.changedLines) {
      const sides = computeSideInlineRanges(hunks);
      const inline = side === "left" ? sides.left : sides.right;
      pos = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        pushInline(items, pos, line, inline.get(i + 1), wordMark);
        pos += line.length + 1;
      }
    }
  }

  items.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const it of items) builder.add(it.from, it.to, it.deco);
  return builder.finish();
}

function pushInline(
  items: { from: number; to: number; deco: Decoration }[],
  pos: number,
  line: string,
  ranges: CharRange[] | undefined,
  deco: Decoration,
) {
  if (!ranges?.length) return;
  for (const r of ranges) {
    const from = pos + r.from;
    const to = pos + Math.min(r.to, line.length);
    if (from < to) items.push({ from, to, deco });
  }
}

function buildGutterMarkers(doc: string, hunks: DiffHunk[], side: string, unified: boolean) {
  const builder = new RangeSetBuilder<GutterMarker>();
  if (!doc) return builder.finish();
  const lines = doc.split("\n");
  if (unified) {
    let pos = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.startsWith("+")) builder.add(pos, pos, insertGutter);
      else if (line.startsWith("-")) builder.add(pos, pos, deleteGutter);
      pos += line.length + 1;
    }
  } else {
    const { changed, kind } = changedLineSet(hunks, side);
    const marker = kind === "delete" ? deleteGutter : insertGutter;
    let pos = 0;
    for (let i = 0; i < lines.length; i++) {
      if (changed.has(i + 1)) builder.add(pos, pos, marker);
      pos += (lines[i]?.length ?? 0) + 1;
    }
  }
  return builder.finish();
}

function unifiedText(hunks: DiffHunk[]): string {
  return hunks.map((h) => `${h.header}\n${h.lines.join("\n")}`).join("\n");
}

function theme() {
  return EditorView.theme({
    "&": {
      height: "100%",
      fontSize: "12px",
      backgroundColor: "var(--color-background)",
      color: "var(--color-foreground)",
    },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.45" },
    ".cm-content": { caretColor: "transparent" },
    ".cm-gutters": {
      backgroundColor: "var(--color-background)",
      color: "var(--color-muted-foreground)",
      borderRight: "1px solid var(--color-border)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--color-selection)",
    },
    "::selection": { color: "var(--color-selection-foreground)" },
    ".cm-diff-insert": {
      backgroundColor: "rgb(var(--diff-insert-bg) / 0.9)",
    },
    ".cm-diff-delete": {
      backgroundColor: "rgb(var(--diff-delete-bg) / 0.9)",
    },
    ".cm-diff-word-insert": {
      backgroundColor: "rgb(var(--diff-word-insert) / 1)",
      borderRadius: "2px",
    },
    ".cm-diff-word-delete": {
      backgroundColor: "rgb(var(--diff-word-delete) / 1)",
      borderRadius: "2px",
    },
    ".cm-diff-change-gutter": {
      width: "4px",
      minWidth: "4px",
    },
    ".cm-diff-gutter-insert": {
      width: "3px",
      height: "100%",
      marginLeft: "1px",
      backgroundColor: "rgb(var(--gutter-added) / 1)",
    },
    ".cm-diff-gutter-delete": {
      width: "3px",
      height: "100%",
      marginLeft: "1px",
      backgroundColor: "rgb(var(--gutter-deleted) / 1)",
    },
  });
}

function fingerprint(): string {
  const content = contentForProps();
  return contentFingerprint({
    paintKey: props.paintKey ?? "",
    side: props.side,
    unified: !!(props.unified || props.side === "unified"),
    content,
    hunks: props.hunks,
    changedCount: props.changedLines?.size ?? 0,
    lineMapLen: props.lineMap?.length ?? 0,
    enableInline: props.enableInline !== false,
  });
}

function contentForProps(): string {
  return props.unified || props.side === "unified" ? unifiedText(props.hunks) : props.text;
}

function lineNumberExt() {
  if (!props.lineMap?.length) return lineNumbers();
  const map = props.lineMap;
  return lineNumbers({
    formatNumber: (n) => {
      const orig = map[n - 1];
      if (!orig) return "·";
      return String(orig);
    },
  });
}

function detachResize() {
  resizeObserver?.disconnect();
  resizeObserver = null;
}

function attachResize(el: HTMLElement) {
  detachResize();
  if (typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver(() => {
    // Zero-height first paint (flex/splitpane) left CM blank until a tab flip
    // resized the pane — remeasure as soon as the host gets a real size.
    view?.requestMeasure();
  });
  resizeObserver.observe(el);
}

function forceHostLayout(el: HTMLElement) {
  // WebView2/Tauri sometimes keeps a stale compositor layer until reflow
  // (tool-window tab flip). Nudge layout + visibility after every remount.
  void el.offsetHeight;
  const prev = el.style.transform;
  el.style.transform = "translateZ(0)";
  void el.offsetHeight;
  el.style.transform = prev;
}

function mountNow() {
  const hostEl = hostRef.value;
  if (!hostEl) {
    const token = mountToken;
    requestAnimationFrame(() => {
      if (token !== mountToken) return;
      if (hostRef.value) mountNow();
    });
    return;
  }
  const fp = fingerprint();
  const content = contentForProps();
  if (view && fp === lastFingerprint && view.state.doc.toString() === content) {
    view.requestMeasure();
    forceHostLayout(hostEl);
    return;
  }
  lastFingerprint = fp;
  const saved = !view && props.initialViewState?.docLength === content.length
    ? props.initialViewState : undefined;
  mountedKey = props.paintKey ?? "";
  selectionVisible = saved?.selectionVisible ?? false;

  detachScroll();
  detachSelection?.();
  detachSelection = null;
  view?.destroy();
  view = null;
  // Clear any leftover CM DOM from a prior view before recreating.
  hostEl.replaceChildren();

  const unified = !!(props.unified || props.side === "unified");
  const deco = buildDecorations(content, props.hunks, props.side, unified);
  const gutters = buildGutterMarkers(content, props.hunks, props.side, unified);

  view = new EditorView({
    parent: hostEl,
    scrollTo: saved?.scroll,
    state: EditorState.create({
      doc: content,
      selection: saved?.selection,
      extensions: [
        lineNumberExt(),
        gutter({
          class: "cm-diff-change-gutter",
          markers: () => gutters,
        }),
        EditorView.editable.of(false),
        theme(),
        EditorView.decorations.of(deco),
      ],
    }),
  });
  attachScroll();
  attachSelection(view);
  attachResize(hostEl);
  view.requestMeasure();
  if (saved?.selectionVisible) restoreVisibleSelection(view);
  forceHostLayout(hostEl);
}

function restoreVisibleSelection(editor: EditorView) {
  // Restore the native read-only selection after CM has rendered the saved viewport.
  // Keep keyboard focus on the tab/toolbar that the user used to navigate.
  editor.requestMeasure({
    read: () => {
      const { anchor, head } = editor.state.selection.main;
      const visible = (pos: number) => editor.visibleRanges.some(
        ({ from, to }) => pos >= from && pos <= to,
      );
      return visible(anchor) && visible(head)
        ? { anchor: editor.domAtPos(anchor), head: editor.domAtPos(head) }
        : null;
    },
    write: (positions) => {
      if (view !== editor || !positions) return;
      const { anchor, head } = positions;
      editor.dom.ownerDocument.getSelection()?.setBaseAndExtent(
        anchor.node, anchor.offset, head.node, head.offset,
      );
    },
  });
}

function saveViewState() {
  if (!view || !mountedKey) return;
  emit("saveViewState", {
    key: mountedKey,
    side: props.side,
    state: {
      scroll: view.scrollSnapshot(),
      selection: view.state.selection,
      selectionVisible,
      docLength: view.state.doc.length,
    },
  });
}

function attachSelection(editor: EditorView) {
  const document = editor.dom.ownerDocument;
  const changed = () => {
    const selection = document.getSelection();
    const anchor = selection?.anchorNode;
    const head = selection?.focusNode;
    if (!anchor || !head) return;
    if (editor.contentDOM.contains(anchor) && editor.contentDOM.contains(head)) {
      selectionVisible = !selection.isCollapsed;
    } else {
      const element = anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement;
      // Remember the last selected pane even if navigation selects a file name
      // before unmount. Selecting the other diff pane transfers ownership.
      if (element?.closest("[data-diff-pane]")) selectionVisible = false;
    }
  };
  document.addEventListener("selectionchange", changed);
  detachSelection = () => document.removeEventListener("selectionchange", changed);
}

function scheduleMount() {
  const token = ++mountToken;
  // flush:post watch already ran after DOM update — mount synchronously so
  // selection changes paint in the same frame, not after a tab flip.
  queueMicrotask(() => {
    if (token !== mountToken) return;
    mountNow();
  });
}

function attachScroll() {
  const scroller = view?.scrollDOM;
  if (!scroller) return;
  onScroll = () => {
    if (syncing || !view) return;
    emit("scroll", { left: scroller.scrollLeft, top: scroller.scrollTop });
  };
  scroller.addEventListener("scroll", onScroll, { passive: true });
}

function detachScroll() {
  if (onScroll && view) {
    view.scrollDOM.removeEventListener("scroll", onScroll);
  }
  onScroll = null;
}

function getScroller() {
  return view?.scrollDOM ?? null;
}

function applyScroll(left: number, top: number) {
  const scroller = view?.scrollDOM;
  if (!scroller) return;
  syncing = true;
  if (scroller.scrollLeft !== left) scroller.scrollLeft = left;
  if (scroller.scrollTop !== top) scroller.scrollTop = top;
  requestAnimationFrame(() => {
    syncing = false;
  });
}

defineExpose({ getScroller, applyScroll });

onMounted(() => scheduleMount());
onBeforeUnmount(() => {
  mountToken += 1;
  saveViewState();
  detachSelection?.();
  detachSelection = null;
  detachScroll();
  detachResize();
  view?.destroy();
  view = null;
});
watch(
  () =>
    [
      props.paintKey,
      props.text,
      props.hunks,
      props.side,
      props.unified,
      props.changedLines,
      props.lineMap,
      props.enableInline,
    ] as const,
  () => scheduleMount(),
  { flush: "post" },
);
</script>

<template>
  <div ref="hostRef" data-diff-pane class="h-full min-h-0 overflow-hidden" />
</template>
