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
