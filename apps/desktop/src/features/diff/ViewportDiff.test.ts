import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, onBeforeUnmount } from "vue";
import ViewportDiff from "./ViewportDiff.vue";
import type { DiffHunk } from "@/lib/backend";

enableAutoUnmount(afterEach);
const snapshot = { docLength: 12, selectionVisible: false };
const editor = defineComponent({
  props: ["paintKey", "initialViewState"],
  emits: ["saveViewState"],
  setup(props, { emit }) {
    const key = props.paintKey;
    onBeforeUnmount(() => emit("saveViewState", { key, state: snapshot }));
    return () => h("div", { "data-editor": "" });
  },
});
class Observer {
  static instances: Observer[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(
    public callback: IntersectionObserverCallback,
    public options: IntersectionObserverInit,
  ) {
    Observer.instances.push(this);
  }
  visible(value: boolean) {
    this.callback(
      [{ isIntersecting: value } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  Observer.instances = [];
  vi.stubGlobal("IntersectionObserver", Observer);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
const hunks = (): DiffHunk[] => [
  {
    index: 0,
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    header: "@@",
    lines: ["-old", "+new"],
  },
];
const create = () =>
  mount(ViewportDiff, { props: { hunks: hunks() }, global: { stubs: { CodeMirrorDiff: editor } } });

it("mounts only near the scrollport and restores a compact snapshot on return", async () => {
  const root = document.createElement("div");
  root.dataset.diffScrollport = "";
  document.body.append(root);
  const wrapper = mount(ViewportDiff, {
    attachTo: root,
    props: { hunks: hunks() },
    global: { stubs: { CodeMirrorDiff: editor } },
  });
  const observer = Observer.instances[0]!;
  expect(observer.options.root).toBe(root);
  expect(wrapper.find("[data-editor]").exists()).toBe(false);
  observer.visible(true);
  await vi.advanceTimersByTimeAsync(60);
  await flushPromises();
  expect(wrapper.find("[data-editor]").exists()).toBe(true);
  observer.visible(false);
  await flushPromises();
  expect(wrapper.find("[data-editor]").exists()).toBe(false);
  observer.visible(true);
  await vi.advanceTimersByTimeAsync(60);
  await flushPromises();
  expect(wrapper.findComponent(editor).props("initialViewState")).toEqual(snapshot);
  wrapper.unmount();
  expect(observer.disconnect).toHaveBeenCalledOnce();
});

it("discards old snapshots when refreshed hunks arrive, including stale unmount events", async () => {
  const wrapper = create();
  const observer = Observer.instances[0]!;
  observer.visible(true);
  await vi.advanceTimersByTimeAsync(60);
  await flushPromises();
  await wrapper.setProps({ hunks: hunks() });
  observer.visible(false);
  await flushPromises();
  observer.visible(true);
  await vi.advanceTimersByTimeAsync(60);
  await flushPromises();
  expect(wrapper.findComponent(editor).props("initialViewState")).toBeUndefined();
});

it("renders normally when intersection observation is unavailable", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const wrapper = create();
  await flushPromises();
  expect(wrapper.find("[data-editor]").exists()).toBe(true);
});

it("skips editor construction during a fast pass and cancels queued work on unmount", async () => {
  const wrapper = create();
  const observer = Observer.instances[0]!;
  observer.visible(true);
  await flushPromises();
  expect(wrapper.text()).toContain("+new");
  expect(wrapper.find("[data-editor]").exists()).toBe(false);
  observer.visible(false);
  await vi.advanceTimersByTimeAsync(80);
  expect(wrapper.find("[data-editor]").exists()).toBe(false);
  observer.visible(true);
  await flushPromises();
  wrapper.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
