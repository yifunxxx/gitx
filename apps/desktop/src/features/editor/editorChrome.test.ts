import { expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorChrome } from "./editorChrome";

it("enables drawn selection and a visible caret by default", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({ doc: "abc", extensions: editorChrome() }),
  });
  expect(view.dom.querySelector(".cm-cursorLayer")).toBeTruthy();
  const sheet = [...document.styleSheets]
    .flatMap((s) => {
      try {
        return [...s.cssRules];
      } catch {
        return [];
      }
    })
    .map((rule) => rule.cssText)
    .join("\n");
  expect(sheet).toContain("caret-color: var(--color-foreground)");
  expect(sheet).toContain("border-left-color: var(--color-foreground)");
  view.destroy();
  host.remove();
});

it("can hide the caret for read-only panes", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: "abc",
      extensions: [...editorChrome({ caret: false }), EditorView.editable.of(false)],
    }),
  });
  const sheet = [...document.styleSheets]
    .flatMap((s) => {
      try {
        return [...s.cssRules];
      } catch {
        return [];
      }
    })
    .map((rule) => rule.cssText)
    .join("\n");
  expect(sheet).toContain("caret-color: transparent");
  view.destroy();
  host.remove();
});
