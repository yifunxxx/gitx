import type { EditorSelection, StateEffect } from "@codemirror/state";

export type DiffPaneSide = "left" | "right" | "unified";

/** Only changed axes are linked; the other pane may have a different range. */
export type DiffPaneScroll = { left?: number; top?: number };

/** Small position snapshots only: never retain editor instances, DOM or file text. */
export type DiffPaneViewState = {
  scroll: StateEffect<unknown>;
  selection: EditorSelection;
  selectionVisible: boolean;
  docLength: number;
};

export type DiffPaneSnapshot = {
  key: string;
  side: DiffPaneSide;
  state: DiffPaneViewState;
};

export function diffViewKey(tab: {
  id: string;
  contentVersion?: number;
  collapseUnchanged: boolean;
  unified: boolean;
}): string {
  return JSON.stringify([tab.id, tab.contentVersion ?? 0, tab.collapseUnchanged, tab.unified]);
}
