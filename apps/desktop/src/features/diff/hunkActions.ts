import { RangeSet, type EditorState } from "@codemirror/state";
import { GutterMarker, ViewPlugin, gutter, type EditorView } from "@codemirror/view";
import type { DiffHunk } from "@/lib/backend";

export type HunkAction = "stage" | "unstage" | "revert";
export type HunkAnchor = { index: number; line: number };
export type HunkControl = { action: HunkAction; label: string };

/** Expanded unified documents add deleted rows before later original hunks. */
export function unifiedHunkAnchors(hunks: DiffHunk[], expanded: boolean): HunkAnchor[] {
  let row = expanded ? 2 : 1;
  let cursor = 0;
  return hunks.map((hunk) => {
    const start = Math.max(0, hunk.newStart - 1);
    if (expanded) row += Math.max(0, start - cursor);
    const anchor = { index: hunk.index, line: row };
    row += hunk.lines.length + (expanded ? 0 : 1);
    cursor = start + hunk.newLines;
    return anchor;
  });
}

class Actions extends GutterMarker {
  constructor(
    readonly indexes: number[],
    readonly controls: HunkControl[],
    readonly disabled: boolean,
    readonly run: (index: number, action: HunkAction) => void,
  ) {
    super();
  }
  toDOM(view: EditorView) {
    const wrap = view.dom.ownerDocument.createElement("span");
    wrap.className = "diff-hunk-actions";
    for (const index of this.indexes)
      for (const control of this.controls) {
        const button = view.dom.ownerDocument.createElement("button");
        button.type = "button";
        button.className = "diff-hunk-action";
        button.dataset.hunkIndex = String(index);
        button.dataset.hunkAction = control.action;
        button.textContent =
          control.action === "stage" ? "+" : control.action === "unstage" ? "−" : "↶";
        button.title = `${control.label} (${index + 1})`;
        button.setAttribute("aria-label", button.title);
        button.disabled = this.disabled;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.run(index, control.action);
        });
        wrap.append(button);
      }
    return wrap;
  }
}

// These gutters contain keyboard controls, unlike decorative line numbers.
const accessibleHunks = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      view.requestMeasure({
        read: () => view.dom.querySelector(".cm-diff-hunk-gutter"),
        write: (actions) => {
          const parent = actions?.parentElement;
          if (!parent?.classList.contains("cm-gutters")) return;
          parent.removeAttribute("aria-hidden");
          for (const child of parent.children) {
            if (child !== actions) child.setAttribute("aria-hidden", "true");
          }
        },
      });
    }
  },
);

export function hunkActionGutter(
  state: EditorState,
  anchors: HunkAnchor[],
  controls: HunkControl[],
  disabled: boolean,
  run: (index: number, action: HunkAction) => void,
) {
  if (!controls.length) return [];
  const positions = new Map<number, number[]>();
  for (const anchor of anchors) {
    const pos = state.doc.line(Math.max(1, Math.min(state.doc.lines, anchor.line))).from;
    const indexes = positions.get(pos) ?? [];
    indexes.push(anchor.index);
    positions.set(pos, indexes);
  }
  const markers = RangeSet.of(
    [...positions].map(([pos, indexes]) =>
      new Actions(indexes, controls, disabled, run).range(pos),
    ),
    true,
  );
  return [accessibleHunks, gutter({ class: "cm-diff-hunk-gutter", markers: () => markers })];
}
