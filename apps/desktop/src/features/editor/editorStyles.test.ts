import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { markRaw, reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorChrome } from "./editorChrome";
import CodeMirrorDiff from "@/features/diff/CodeMirrorDiff.vue";
import FileViewer from "@/features/file/FileViewer.vue";
import ShelfPatchView from "@/features/stash/ShelfPatchView.vue";
import MergeTextPane from "@/features/merge/MergeTextPane.vue";
import { mergeViewConfig } from "@/features/merge/mergeDocument";
import TextViewport from "@/components/common/TextViewport.vue";
import ConsoleView from "@/components/layout/ConsoleView.vue";
import { useConsoleStore } from "@/stores/consoleStore";

const mocks = vi.hoisted(() => ({ store: {} as any }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => mocks.store }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

// Measure retained CSS in the DOM, including after the owning views are destroyed.
// A warm-up permits each finite variant to register its styles once.
function styles() {
  const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
  return { rules: rules.length, chars: rules.map((rule) => rule.cssText).join("\n").length };
}
async function expectBoundedStyles(cycle: (index: number) => void | Promise<void>) {
  await cycle(0);
  const warm = styles();
  for (let i = 1; i <= 12; i++) await cycle(i);
  expect(styles()).toEqual(warm);
  expect(document.querySelectorAll(".cm-editor")).toHaveLength(0);
}

it("bounds shared caret styles across reconfiguration and new editor lifetimes", async () => {
  await expectBoundedStyles(() => {
    const host = document.body.appendChild(document.createElement("div"));
    const chrome = new Compartment();
    const view = new EditorView({ parent: host, extensions: chrome.of(editorChrome()) });
    try {
      for (const caret of [false, true, false]) {
        view.dispatch({ effects: chrome.reconfigure(editorChrome({ caret })) });
      }
    } finally {
      view.destroy();
      host.remove();
    }
  });
});

it.each(["left", "right", "unified"] as const)(
  "bounds %s diff styles across content refreshes and remounts",
  async (side) => {
    await expectBoundedStyles(async (index) => {
      const hunk = {
        index: 0,
        header: "@@ -1 +1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ["-before", "+after"],
      };
      const wrapper = mount(CodeMirrorDiff, {
        props: { text: "after", hunks: [hunk], side, paintKey: `diff-${index}` },
        attachTo: document.body,
      });
      try {
        await flushPromises();
        await wrapper.setProps({
          text: `refresh-${index}`,
          hunks: [{ ...hunk, lines: ["-before", `+refresh-${index}`] }],
        });
        await flushPromises();
        expect(wrapper.get(".cm-content").attributes("contenteditable")).toBe("false");
        expect(wrapper.text()).toContain(`refresh-${index}`);
      } finally {
        wrapper.unmount();
      }
    });
  },
);

it("bounds Shelf preview styles across patch replacement and remounts", async () => {
  await expectBoundedStyles(async (index) => {
    const wrapper = mount(ShelfPatchView, {
      props: { text: "@@ -1 +1 @@\n-old\n+new", label: "Patch" },
      attachTo: document.body,
    });
    try {
      await flushPromises();
      await wrapper.setProps({
        text: `@@ -1 +1 @@\n-old\n+new-${index}`,
        label: "Refreshed patch",
      });
      await flushPromises();
      expect(wrapper.get(".cm-content").attributes("contenteditable")).toBe("false");
      expect(wrapper.find(".cm-patch-added").exists()).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });
});

it("bounds file styles across editable/read-only tab switches and reloads", async () => {
  mocks.store = reactive({
    tabs: [
      {
        id: "edit",
        text: "editable",
        baseline: "editable",
        hunks: [],
        editable: true,
        loadGeneration: 0,
      },
      {
        id: "read",
        text: "read-only",
        baseline: "read-only",
        hunks: [],
        editable: false,
        loadGeneration: 0,
      },
    ],
  });
  await expectBoundedStyles(async (index) => {
    const wrapper = mount(FileViewer, { props: { tabId: "edit" }, attachTo: document.body });
    try {
      await flushPromises();
      expect(wrapper.get(".cm-content").attributes("contenteditable")).toBe("true");
      await wrapper.setProps({ tabId: "read" });
      expect(wrapper.get(".cm-content").attributes("contenteditable")).toBe("false");
      mocks.store.tabs[1].text = `reloaded-${index}`;
      mocks.store.tabs[1].baseline = mocks.store.tabs[1].text;
      mocks.store.tabs[1].loadGeneration++;
      await flushPromises();
      expect(wrapper.text()).toContain(`reloaded-${index}`);
    } finally {
      wrapper.unmount();
    }
  });
});

it("bounds merge styles across state/config changes and remounts", async () => {
  const state = (text: string) =>
    markRaw(EditorState.create({ doc: text, extensions: mergeViewConfig.of([]) }));
  await expectBoundedStyles(async (index) => {
    const wrapper = mount(MergeTextPane, {
      props: { state: state("result"), ownerId: "result", label: "Result", editable: true },
      attachTo: document.body,
    });
    try {
      await flushPromises();
      await wrapper.setProps({ disabled: true });
      expect(wrapper.get(".cm-content").attributes("contenteditable")).toBe("false");
      await wrapper.setProps({
        state: state(`result-${index}`),
        label: "New result",
        disabled: false,
      });
      expect(wrapper.get(".cm-content").attributes("contenteditable")).toBe("true");
      expect(wrapper.text()).toContain(`result-${index}`);
    } finally {
      wrapper.unmount();
    }
  });
});

it("bounds text viewport styles across editable/read-only lifetimes", async () => {
  await expectBoundedStyles(async (index) => {
    for (const editable of [false, true]) {
      const wrapper = mount(TextViewport, {
        props: { text: `text-${index}`, label: "Text", editable },
        attachTo: document.body,
      });
      try {
        await wrapper.setProps({ text: `refreshed-${index}`, disabled: true });
        expect(wrapper.get(".cm-content").attributes("contenteditable")).toBe("false");
        expect(wrapper.text()).toContain(`refreshed-${index}`);
      } finally {
        wrapper.unmount();
      }
    }
  });
});

it("bounds console styles across repeated opening and closing", async () => {
  const store = useConsoleStore();
  store.append("stderr", "example error");
  await expectBoundedStyles(async () => {
    const wrapper = mount(ConsoleView, { attachTo: document.body });
    try {
      await flushPromises();
      expect(wrapper.get(".cm-content").attributes("contenteditable")).toBe("false");
      expect(wrapper.find(".console-stderr").exists()).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });
});
