import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, shallowMount } from "@vue/test-utils";
import { reactive } from "vue";
import { EditorView } from "@codemirror/view";
import DiffViewer from "./DiffViewer.vue";
import CodeMirrorDiff from "./CodeMirrorDiff.vue";

const mocks = vi.hoisted(() => ({ diffs: {} as any }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => mocks.diffs }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => ({ repoId: "repo", repoPath: "repo" }) }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({}) }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
enableAutoUnmount(afterEach);

beforeEach(() => {
  mocks.diffs = reactive({
    activeId: "diff", getPaneViewState: vi.fn(), savePaneViewState: vi.fn(),
    tabs: [{
      id: "diff", path: "file.txt", kind: "file", left: "head", right: "index",
      loading: false, textsLoaded: true, collapseUnchanged: false, unified: false,
      ignoreWhitespace: "none", result: {
        leftText: "left\n".repeat(200), rightText: "right\n".repeat(20),
        hunks: [], binary: false, tooLarge: false,
      },
    }],
  });
});

async function create() {
  const wrapper = shallowMount(DiffViewer, {
    props: { tabId: "diff" },
    global: { stubs: {
      CodeMirrorDiff: false,
      Tip: { template: "<div><slot /></div>" },
      Button: { template: "<button><slot /></button>" },
    } },
  });
  await flushPromises();
  const panes = wrapper.findAll(".cm-scroller").map((pane) => pane.element as HTMLElement);
  expect(panes).toHaveLength(2);
  limitScroll(panes[0]!, 2000, 1000);
  limitScroll(panes[1]!, 300, 100);
  return { wrapper, left: panes[0]!, right: panes[1]! };
}

// happy-dom has no layout. Model browser clamping and explicitly dispatch
// feedback later, while using the real parent wiring and CodeMirror panes.
function limitScroll(pane: HTMLElement, maxTop: number, maxLeft: number) {
  let top = 0;
  let left = 0;
  Object.defineProperties(pane, {
    scrollTop: {
      configurable: true, get: () => top,
      set: (value: number) => { top = Math.max(0, Math.min(maxTop, value)); },
    },
    scrollLeft: {
      configurable: true, get: () => left,
      set: (value: number) => { left = Math.max(0, Math.min(maxLeft, value)); },
    },
  });
}
function scroll(pane: HTMLElement, top: number, left: number) {
  pane.scrollTop = top;
  pane.scrollLeft = left;
  pane.dispatchEvent(new Event("scroll"));
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

it("accepts a new user scroll before the preceding synchronization frame ends", async () => {
  const { left, right } = await create();
  scroll(left, 800, 500);
  expect(right.scrollTop).toBe(300);
  scroll(right, 180, 100);
  expect(left.scrollTop).toBe(180);
  expect(left.scrollLeft).toBe(500);
});

it("does not propagate the short pane's unchanged axis with later horizontal input", async () => {
  const { left, right } = await create();
  scroll(left, 800, 500);
  await frame();
  scroll(right, 300, 60);
  expect(left.scrollLeft).toBe(60);
  expect(left.scrollTop).toBe(800);
});

it("suppresses clamped feedback after a frame and keeps later vertical input independent", async () => {
  const { wrapper, left, right } = await create();
  scroll(left, 800, 500);
  await frame();
  right.dispatchEvent(new Event("scroll"));
  expect(left.scrollTop).toBe(800);
  expect(left.scrollLeft).toBe(500);
  expect(wrapper.findAllComponents(CodeMirrorDiff)[1]!.emitted("scroll")).toBeUndefined();
  scroll(right, 160, 100);
  expect(left.scrollTop).toBe(160);
  expect(left.scrollLeft).toBe(500);
});

it("does not carry scroll suppression into editors replaced by refreshed content", async () => {
  const { wrapper, left, right } = await create();
  scroll(left, 800, 500);
  mocks.diffs.tabs[0].result.rightText = "refreshed\n".repeat(40);
  await flushPromises();
  const nextRight = wrapper.findAll(".cm-scroller")[1]!.element as HTMLElement;
  expect(nextRight).not.toBe(right);
  limitScroll(nextRight, 600, 200);
  scroll(nextRight, 80, 0);
  expect(left.scrollTop).toBe(80);
  scroll(right, 200, 20);
  expect(left.scrollTop).toBe(80);
  const destroy = wrapper.findAll(".cm-editor").map((pane) =>
    vi.spyOn(EditorView.findFromDOM(pane.element as HTMLElement)!, "destroy"),
  );
  wrapper.unmount();
  destroy.forEach((call) => expect(call).toHaveBeenCalledOnce());
  scroll(nextRight, 120, 0);
  expect(left.scrollTop).toBe(80);
});
