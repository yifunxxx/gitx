import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import ConsoleView from "./ConsoleView.vue";
import { useConsoleStore } from "@/stores/consoleStore";

enableAutoUnmount(afterEach);
let frames: FrameRequestCallback[];
beforeEach(() => {
  setActivePinia(createPinia());
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());
async function renderOutput() {
  await flushPromises();
  const queued = frames;
  frames = [];
  queued.forEach((fn) => fn(0));
  await flushPromises();
}
function editor(wrapper: ReturnType<typeof mount>) {
  return EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;
}

it("bounds rendered console lines while preserving multiline output, colors and selection on append", async () => {
  const store = useConsoleStore();
  for (let i = 0; i < 5000; i++) store.append("stdout", `line ${i}`);
  const wrapper = mount(ConsoleView);
  const view = editor(wrapper);
  expect(view.state.doc.toString()).toContain("line 4999");
  expect(wrapper.findAll(".cm-line").length).toBeLessThan(100);
  view.dispatch({ selection: EditorSelection.range(100, 110) });
  store.append("stderr", "first error\nsecond error");
  await renderOutput();
  expect(editor(wrapper)).toBe(view);
  expect(view.state.doc.toString().startsWith("stdout  line 1\n")).toBe(true);
  expect(view.state.doc.toString()).toContain("stderr  first error\nsecond error\n");
  expect(view.state.selection.main.from).toBe(100 - "stdout  line 0\n".length);
  expect(view.state.selection.main.to).toBe(110 - "stdout  line 0\n".length);
  const colors: number[] = [];
  for (const provider of view.state.facet(EditorView.decorations)) {
    if (typeof provider !== "function")
      provider.between(0, view.state.doc.length, (from, _to, mark) => {
        if (mark.spec.class === "console-stderr") colors.push(from);
      });
  }
  expect(colors).toHaveLength(2);
});

it("coalesces a burst of output and clears the document without recreating the editor", async () => {
  const store = useConsoleStore();
  const wrapper = mount(ConsoleView);
  const view = editor(wrapper);
  const dispatch = vi.spyOn(view, "dispatch");
  for (let i = 0; i < 100; i++) store.append("cmd", `git status ${i}`);
  await renderOutput();
  expect(dispatch).toHaveBeenCalledOnce();
  expect(view.state.doc.toString()).toContain("git status 99");
  store.clear();
  await renderOutput();
  expect(view.state.doc.length).toBe(0);
  expect(editor(wrapper)).toBe(view);
  expect(wrapper.text()).toContain("Console is empty");
});
