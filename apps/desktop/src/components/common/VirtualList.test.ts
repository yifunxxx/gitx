import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import VirtualList from "./VirtualList.vue";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it("keeps the visible commit in place when newer history is prepended", async () => {
  const items = Array.from({ length: 100 }, (_, i) => String(i + 100));
  const wrapper = mount(VirtualList, {
    props: {
      items,
      itemHeight: 22,
      getKey: (item: unknown) => String(item),
      preserveScrollAnchor: true,
    },
  });
  const scrollport = wrapper.get(".overflow-auto").element;
  scrollport.scrollTop = 440;
  await wrapper.setProps({
    items: [...Array.from({ length: 100 }, (_, i) => String(i)), ...items],
  });
  await flushPromises();
  expect(scrollport.scrollTop).toBe(2640);
  wrapper.unmount();
});

it("keeps an explicit navigation from being overwritten by a queued anchor restore", async () => {
  const items = Array.from({ length: 100 }, (_, i) => String(i));
  const wrapper = mount(VirtualList, {
    props: { items, itemHeight: 22, getKey: String, preserveScrollAnchor: true },
  });
  const port = wrapper.get(".overflow-auto").element;
  Object.defineProperty(port, "clientHeight", { configurable: true, value: 400 });
  port.scrollTop = 440;
  const update = wrapper.setProps({ items: ["new", ...items] });
  await nextTick();
  (
    wrapper.vm as unknown as { scrollToIndex: (index: number, align: "center") => void }
  ).scrollToIndex(80, "center");
  await update;
  await flushPromises();
  expect(port.scrollTop).toBe(1571);
  wrapper.unmount();
});

it("emits the scrollport as the trailing scroll target when dragging ends outside the window", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const wrapper = mount(VirtualList, { props: { items: ["one"], itemHeight: 22, getKey: String } });
  const port = wrapper.get(".overflow-auto");
  await port.trigger("pointerdown", { button: 0 });
  window.dispatchEvent(new Event("blur"));
  frames.forEach((callback) => callback(0));
  expect((wrapper.emitted("scroll")![0]![0] as Event).target).toBe(port.element);
  expect((wrapper.vm as unknown as { pointerDown: boolean }).pointerDown).toBe(false);
  wrapper.unmount();
});

it("keeps thumb-drag deferral when lostpointercapture fires with the button still held", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const items = Array.from({ length: 200 }, (_, i) => `row-${i}`);
  const wrapper = mount(VirtualList, {
    props: { items, itemHeight: 22, getKey: String, recycleKeys: true, overscan: 2 },
    slots: { default: `<span class="cell">{{ params.item }}</span>` },
  });
  const port = wrapper.get(".overflow-auto").element;
  Object.defineProperty(port, "clientHeight", { configurable: true, value: 220 });
  port.dispatchEvent(new Event("scroll"));
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  expect(wrapper.findAll(".cell")[0]!.text()).toBe("row-0");
  await wrapper.get(".overflow-auto").trigger("pointerdown", { button: 0 });
  port.scrollTop = 880;
  port.dispatchEvent(new Event("scroll"));
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  window.dispatchEvent(Object.assign(new Event("lostpointercapture"), { buttons: 1 }));
  await nextTick();
  expect((wrapper.vm as unknown as { pointerDown: boolean }).pointerDown).toBe(true);
  expect(wrapper.findAll(".cell")[0]!.text()).toBe("row-0");
  window.dispatchEvent(new Event("pointerup"));
  await nextTick();
  expect(wrapper.findAll(".cell")[0]!.text()).not.toBe("row-0");
  wrapper.unmount();
});

it("suppresses hover/title while scrolling without disabling pointer events", async () => {
  vi.useFakeTimers();
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const wrapper = mount(VirtualList, {
    props: { items: ["a", "b", "c"], itemHeight: 22, getKey: String },
    slots: {
      default: `<button type="button" class="row" title="tip">{{ params.item }}</button>`,
    },
  });
  const port = wrapper.get(".overflow-auto");
  const windowEl = () => wrapper.get("[data-vl-window]");
  expect(windowEl().attributes("data-scrolling")).toBeUndefined();
  expect(windowEl().classes()).not.toContain("pointer-events-none");
  expect(wrapper.get(".row").attributes("title")).toBe("tip");
  // Row click must not enter the scroll-suppress path (v0.1.29 regression).
  await port.trigger("pointerdown", { button: 0 });
  await nextTick();
  expect((wrapper.vm as unknown as { scrolling: boolean }).scrolling).toBe(false);
  expect(windowEl().attributes("data-scrolling")).toBeUndefined();
  expect(wrapper.get(".row").attributes("title")).toBe("tip");
  window.dispatchEvent(new Event("pointerup"));
  await nextTick();
  await port.trigger("scroll");
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  expect(windowEl().attributes("data-scrolling")).toBeDefined();
  expect(windowEl().classes()).not.toContain("pointer-events-none");
  expect((wrapper.vm as unknown as { scrolling: boolean }).scrolling).toBe(true);
  expect(wrapper.get(".row").attributes("title")).toBeUndefined();
  expect(wrapper.get(".row").attributes("data-vl-title")).toBe("tip");
  await vi.advanceTimersByTimeAsync(149);
  expect(windowEl().attributes("data-scrolling")).toBeDefined();
  await vi.advanceTimersByTimeAsync(2);
  await nextTick();
  expect(windowEl().attributes("data-scrolling")).toBeUndefined();
  expect((wrapper.vm as unknown as { scrolling: boolean }).scrolling).toBe(false);
  expect(wrapper.get(".row").attributes("title")).toBe("tip");
  // Thumb drag after a scroll: keep suppress while the button stays held.
  await port.trigger("scroll");
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  await port.trigger("pointerdown", { button: 0 });
  await vi.advanceTimersByTimeAsync(200);
  expect(windowEl().attributes("data-scrolling")).toBeDefined();
  window.dispatchEvent(new Event("pointerup"));
  await nextTick();
  await vi.advanceTimersByTimeAsync(160);
  await nextTick();
  expect(windowEl().attributes("data-scrolling")).toBeUndefined();
  wrapper.unmount();
  vi.useRealTimers();
});

it("gates wheel reactive updates so row props are not patched every frame", async () => {
  vi.useFakeTimers();
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const items = Array.from({ length: 200 }, (_, i) => `row-${i}`);
  const wrapper = mount(VirtualList, {
    props: { items, itemHeight: 22, getKey: String, recycleKeys: true, overscan: 2 },
    slots: { default: `<span class="cell">{{ params.item }}</span>` },
  });
  const port = wrapper.get(".overflow-auto").element;
  Object.defineProperty(port, "clientHeight", { configurable: true, value: 220 });
  port.scrollTop = 0;
  port.dispatchEvent(new Event("scroll"));
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  expect(wrapper.findAll(".cell")[0]!.text()).toBe("row-0");
  // Immediate second wheel tick is gated; window stays put until the timeout.
  port.scrollTop = 880;
  port.dispatchEvent(new Event("scroll"));
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  expect(wrapper.findAll(".cell")[0]!.text()).toBe("row-0");
  await vi.advanceTimersByTimeAsync(55);
  await nextTick();
  expect(wrapper.findAll(".cell")[0]!.text()).not.toBe("row-0");
  wrapper.unmount();
  vi.useRealTimers();
});

it("defers reactive windowing while the scrollbar thumb is held", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const items = Array.from({ length: 200 }, (_, i) => `row-${i}`);
  const wrapper = mount(VirtualList, {
    props: { items, itemHeight: 22, getKey: String, recycleKeys: true, overscan: 2 },
    slots: { default: `<span class="cell">{{ params.item }}</span>` },
  });
  const port = wrapper.get(".overflow-auto").element;
  Object.defineProperty(port, "clientHeight", { configurable: true, value: 220 });
  port.dispatchEvent(new Event("scroll"));
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  expect(wrapper.findAll(".cell")[0]!.text()).toBe("row-0");
  await wrapper.get(".overflow-auto").trigger("pointerdown", { button: 0 });
  port.scrollTop = 880;
  port.dispatchEvent(new Event("scroll"));
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  // Still showing the pre-drag window — no remount storm under pointer capture.
  expect(wrapper.findAll(".cell")[0]!.text()).toBe("row-0");
  window.dispatchEvent(new Event("pointerup"));
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  expect(wrapper.findAll(".cell")[0]!.text()).not.toBe("row-0");
  wrapper.unmount();
});

it("bounds variable rows and reaches the final entry after expansion and collapse", async () => {
  const items = Array.from({ length: 10000 }, (_, id) => ({ id, height: id % 2 ? 44 : 244 }));
  const wrapper = mount(VirtualList, {
    props: {
      items,
      itemHeight: 44,
      getItemHeight: (item: any) => item.height,
      getKey: (item: any) => item.id,
      preserveScrollAnchor: true,
    },
    slots: { default: "<span>{{ params.item.id }}</span>" },
  });
  const port = wrapper.get(".overflow-auto").element;
  Object.defineProperty(port, "clientHeight", { configurable: true, value: 400 });
  const api = wrapper.vm as unknown as { scrollToIndex: (index: number) => void };
  api.scrollToIndex(9999);
  await nextTick();
  expect(wrapper.text()).toContain("9999");
  expect(wrapper.findAll("span").length).toBeLessThan(30);
  expect(port.scrollTop).toBe(1_440_000 - 400);
  await wrapper.setProps({ items: items.map((entry) => ({ ...entry, height: 44 })) });
  await flushPromises();
  expect(port.scrollTop).toBe(440_000 - 400);
  expect(wrapper.text()).toContain("9999");
  wrapper.unmount();
});

it("reuses window slots when recycleKeys is enabled", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const items = Array.from({ length: 200 }, (_, i) => `row-${i}`);
  const wrapper = mount(VirtualList, {
    props: {
      items,
      itemHeight: 22,
      getKey: String,
      recycleKeys: true,
      overscan: 2,
    },
    slots: { default: `<span class="cell">{{ params.item }}</span>` },
  });
  const port = wrapper.get(".overflow-auto").element;
  Object.defineProperty(port, "clientHeight", { configurable: true, value: 220 });
  port.scrollTop = 0;
  port.dispatchEvent(new Event("scroll"));
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  const firstKeys = wrapper.findAll(".cell").map((node) => node.text());
  expect(firstKeys[0]).toBe("row-0");
  expect(firstKeys.length).toBeLessThan(30);
  port.scrollTop = 440;
  port.dispatchEvent(new Event("scroll"));
  frames.splice(0).forEach((callback) => callback(0));
  await new Promise((resolve) => setTimeout(resolve, 55));
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  const secondKeys = wrapper.findAll(".cell").map((node) => node.text());
  expect(secondKeys[0]).not.toBe("row-0");
  expect(secondKeys.length).toBeLessThan(30);
  // Slot keys are window indices, so the mounted cell count stays a small pool.
  expect(Math.abs(secondKeys.length - firstKeys.length)).toBeLessThanOrEqual(4);
  wrapper.unmount();
});

it("preserves the visible anchor when an expanded row above it changes height", async () => {
  const items = Array.from({ length: 100 }, (_, id) => ({ id, height: 44 }));
  const wrapper = mount(VirtualList, {
    props: {
      items,
      itemHeight: 44,
      getItemHeight: (item: any) => item.height,
      getKey: (item: any) => item.id,
      preserveScrollAnchor: true,
    },
  });
  const port = wrapper.get(".overflow-auto").element;
  port.scrollTop = 885;
  await wrapper.setProps({
    items: items.map((entry) => (entry.id === 0 ? { ...entry, height: 244 } : entry)),
  });
  await flushPromises();
  expect(port.scrollTop).toBe(1085);
  wrapper.unmount();
});
