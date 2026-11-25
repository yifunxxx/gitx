import { afterEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import type { DiffHunk } from "@/lib/backend";
import { buildCollapsedSides } from "./collapsedDiff";
import { expandUnifiedHunks } from "./expandedDiff";
import { unifiedHunkAnchors, type HunkControl } from "./hunkActions";
import CodeMirrorDiff from "./CodeMirrorDiff.vue";

enableAutoUnmount(afterEach);
afterEach(() => vi.restoreAllMocks());
const hunks: DiffHunk[] = [
  {
    index: 0,
    header: "first",
    oldStart: 2,
    oldLines: 1,
    newStart: 2,
    newLines: 3,
    lines: [" b", "+one", "+two"],
  },
  {
    index: 1,
    header: "second",
    oldStart: 12,
    oldLines: 2,
    newStart: 14,
    newLines: 1,
    lines: ["-l", " m"],
  },
  {
    index: 2,
    header: "third",
    oldStart: 20,
    oldLines: 1,
    newStart: 21,
    newLines: 1,
    lines: ["-t", "+last", "\\ No newline at end of file"],
  },
];
const controls: HunkControl[] = [
  { action: "stage", label: "Stage block" },
  { action: "revert", label: "Roll back block" },
];

it("anchors collapsed unified controls on each actual header, keeping original indexes", () => {
  const doc = hunks.flatMap((hunk) => [hunk.header, ...hunk.lines]);
  const anchors = unifiedHunkAnchors(hunks, false);
  expect(anchors.map((anchor) => doc[anchor.line - 1])).toEqual(["first", "second", "third"]);
  expect(anchors.map((anchor) => anchor.index)).toEqual([0, 1, 2]);
});
it("maps expanded controls past inserted/deleted rows and omitted context", () => {
  const right = "a\nb\none\ntwo\nc\nd\ne\nf\ng\nh\ni\nj\nk\nm\nn\no\np\nq\nr\ns\nlast";
  const expanded = expandUnifiedHunks(hunks, "", right)[0]!;
  const rows = [expanded.header, ...expanded.lines];
  expect(unifiedHunkAnchors(hunks, true).map((anchor) => rows[anchor.line - 1])).toEqual([
    " b",
    "-l",
    "-t",
  ]);
  expect(unifiedHunkAnchors(hunks, true).map((anchor) => anchor.index)).toEqual([0, 1, 2]);
});
it.each(["+", "-"])(
  "anchors a whole-file %s even when the opposite document is empty",
  (prefix) => {
    const hunk = {
      index: 0,
      header: "whole file",
      oldStart: prefix === "+" ? 0 : 1,
      newStart: prefix === "-" ? 0 : 1,
      oldLines: prefix === "+" ? 0 : 1,
      newLines: prefix === "-" ? 0 : 1,
      lines: [`${prefix}content`],
    };
    expect(unifiedHunkAnchors([hunk], true)).toEqual([{ index: 0, line: 2 }]);
    expect(buildCollapsedSides([hunk]).hunkStarts).toEqual([{ index: 0, line: 1 }]);
  },
);
it("aligns collapsed side controls after paired rows and separators", () => {
  const collapsed = buildCollapsedSides(hunks);
  expect(collapsed.hunkStarts).toEqual([
    { index: 0, line: 1 },
    { index: 1, line: 5 },
    { index: 2, line: 8 },
  ]);
  expect(
    collapsed.hunkStarts.map((anchor) => collapsed.left.text.split("\n")[anchor.line - 1]),
  ).toEqual(["b", "l", "t"]);
});
it("uses real focusable buttons, preserves read-only selection and scroll through waiting changes, and destroys the view", async () => {
  const wrapper = mount(CodeMirrorDiff, {
    props: {
      text: "old\nnew\nend",
      hunks: [hunks[0]!],
      side: "right",
      paintKey: "hunk-test",
      hunkAnchors: [{ index: 7, line: 2 }],
      hunkControls: controls,
    },
    attachTo: document.body,
  });
  await flushPromises();
  const editor = EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;
  editor.dispatch({ selection: EditorSelection.single(1, 5) });
  editor.scrollDOM.scrollTop = 10;
  const scrollTop = editor.scrollDOM.scrollTop;
  const original = editor.state.doc.toString();
  const stage = wrapper.get<HTMLButtonElement>('[data-hunk-action="stage"]');
  expect(stage.attributes("aria-label")).toBe("Stage block (8)");
  stage.element.focus();
  expect(document.activeElement).toBe(stage.element);
  stage.element.click();
  expect(wrapper.emitted("hunkAction")).toEqual([[7, "stage"]]);
  await wrapper.setProps({ hunkBusy: true });
  await flushPromises();
  expect(EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)).toBe(editor);
  expect(editor.state.selection.main).toMatchObject({ from: 1, to: 5 });
  expect(editor.scrollDOM.scrollTop).toBe(scrollTop);
  expect(wrapper.get<HTMLButtonElement>('[data-hunk-action="stage"]').element.disabled).toBe(true);
  wrapper.get<HTMLButtonElement>('[data-hunk-action="stage"]').element.click();
  expect(wrapper.emitted("hunkAction")).toHaveLength(1);
  editor.dispatch({ changes: { from: 0, insert: "edit" }, userEvent: "input.type" });
  expect(editor.state.doc.toString()).toBe(original);
  await wrapper.setProps({
    hunkBusy: false,
    hunkControls: [{ action: "unstage", label: "Unstage block" }],
  });
  expect(wrapper.find('[data-hunk-action="stage"]').exists()).toBe(false);
  wrapper.get<HTMLButtonElement>('[data-hunk-action="unstage"]').element.click();
  expect(wrapper.emitted("hunkAction")![1]).toEqual([7, "unstage"]);
  const destroy = vi.spyOn(editor, "destroy");
  wrapper.unmount();
  expect(destroy).toHaveBeenCalledOnce();
});

it("keeps controls for both blocks at a shared empty line and removes them without remounting", async () => {
  const wrapper = mount(CodeMirrorDiff, {
    props: {
      text: "",
      hunks: [],
      side: "right",
      hunkControls: controls,
      hunkAnchors: [
        { index: 0, line: 0 },
        { index: 1, line: 100 },
      ],
    },
  });
  await flushPromises();
  expect(wrapper.findAll("button")).toHaveLength(4);
  const editor = EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;
  await wrapper.setProps({ hunkControls: [] });
  expect(wrapper.findAll("button")).toHaveLength(0);
  expect(EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)).toBe(editor);
});
