import { RangeSet, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  mergeRanges,
  rangePending,
  type MergeChoice,
  type MergeRange,
  type MergeSide,
} from "./mergeDocument";

type Highlight = { from: number; to: number; className: string };
function highlights(view: EditorView, ranges: readonly Highlight[]) {
  const marks: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const visible of view.visibleRanges) {
    for (const range of ranges) {
      if (range.to < visible.from || range.from > visible.to) continue;
      let line = view.state.doc.lineAt(
        Math.min(view.state.doc.length, Math.max(range.from, visible.from)),
      );
      const end = Math.min(visible.to, Math.max(range.from, range.to - 1));
      while (line.from <= end) {
        if (!seen.has(line.from)) {
          marks.push(Decoration.line({ class: range.className }).range(line.from));
          seen.add(line.from);
        }
        if (line.number === view.state.doc.lines) break;
        line = view.state.doc.line(line.number + 1);
      }
    }
  }
  return Decoration.set(marks, true);
}
function highlightPlugin(ranges: (view: EditorView) => readonly Highlight[]) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = highlights(view, ranges(view));
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.transactions.some((tr) => tr.effects.length)
        )
          this.decorations = highlights(update.view, ranges(update.view));
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
export const resultHighlights = highlightPlugin((view) =>
  view.state.field(mergeRanges).map((r) => ({
    from: r.from,
    to: r.to,
    className:
      r.manual && !r.confirmed
        ? "cm-merge-manual"
        : rangePending(r)
          ? "cm-merge-pending"
          : "cm-merge-accepted",
  })),
);

type GutterAction = {
  index: number;
  side: MergeSide;
  choice: MergeChoice;
  disabled: boolean;
  acceptLabel: string;
  ignoreLabel: string;
};
class Actions extends GutterMarker {
  constructor(
    readonly actions: GutterAction[],
    readonly run: (index: number, side: MergeSide, choice: "accept" | "ignore") => void,
  ) {
    super();
  }
  toDOM(view: EditorView) {
    const wrap = view.dom.ownerDocument.createElement("span");
    wrap.className = "merge-actions";
    for (const action of this.actions) {
      for (const choice of ["accept", "ignore"] as const) {
        const button = view.dom.ownerDocument.createElement("button");
        button.type = "button";
        button.className = "merge-action";
        button.dataset.mergeBlock = String(action.index);
        button.dataset.mergeSide = action.side;
        button.dataset.mergeChoice = choice;
        button.dataset.decided = action.choice;
        button.textContent =
          choice === "ignore"
            ? "×"
            : action.choice === "accept"
              ? "✓"
              : action.side === "ours"
                ? "→"
                : "←";
        button.title = choice === "accept" ? action.acceptLabel : action.ignoreLabel;
        button.setAttribute("aria-label", button.title);
        button.disabled = action.disabled || action.choice !== "pending";
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.run(action.index, action.side, choice);
        });
        wrap.append(button);
      }
    }
    return wrap;
  }
}
class Spacer extends GutterMarker {
  toDOM(view: EditorView) {
    const span = view.dom.ownerDocument.createElement("span");
    span.style.cssText = "display:inline-block;width:46px;height:22px";
    return span;
  }
}
// CodeMirror normally hides gutters from assistive technology. These gutters
// contain real controls, so expose them while keeping decorative numbers hidden.
const accessibleActions = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      view.requestMeasure({
        read: () => view.dom.querySelector(".cm-merge-actions"),
        write: (actions) => {
          const container = actions?.parentElement;
          if (!container?.classList.contains("cm-gutters")) return;
          container.removeAttribute("aria-hidden");
          for (const child of container.children)
            if (child !== actions) child.setAttribute("aria-hidden", "true");
        },
      });
    }
  },
);
export function sourceDecorations(
  state: { doc: { length: number; lineAt(pos: number): { from: number } } },
  positions: readonly { index: number; from: number; to: number }[],
  ranges: readonly MergeRange[],
  side: MergeSide,
  disabled: boolean,
  label: (index: number, side: MergeSide, choice: "accept" | "ignore") => string,
  run: (index: number, side: MergeSide, choice: "accept" | "ignore") => void,
) {
  const byIndex = new Map(ranges.map((r) => [r.index, r]));
  const markers = new Map<number, GutterAction[]>();
  const colored: Highlight[] = [];
  for (const pos of positions) {
    const range = byIndex.get(pos.index);
    if (!range) continue;
    const anchor = state.doc.lineAt(Math.min(pos.from, state.doc.length)).from;
    const group = markers.get(anchor) ?? [];
    group.push({
      index: pos.index,
      side,
      choice: range[side],
      disabled: disabled || range.manual,
      acceptLabel: label(pos.index, side, "accept"),
      ignoreLabel: label(pos.index, side, "ignore"),
    });
    markers.set(anchor, group);
    colored.push({
      ...pos,
      className:
        range[side] === "accept"
          ? "cm-merge-accepted"
          : range[side] === "ignore"
            ? "cm-merge-ignored"
            : "cm-merge-pending",
    });
  }
  const set = RangeSet.of(
    [...markers].map(([pos, actions]) => new Actions(actions, run).range(pos)),
    true,
  );
  return [
    accessibleActions,
    highlightPlugin(() => colored),
    gutter({
      class: "cm-merge-actions",
      side: side === "ours" ? "after" : "before",
      markers: () => set,
      initialSpacer: () => new Spacer(),
    }),
  ];
}
