import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
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

it("keeps drag tracking when capture is lost while still rendering current rows", async () => {
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
  expect(wrapper.findAll(".cell").map((row) => row.text())).toContain("row-40");
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
  expect(wrapper.get(".row").attributes("title")).toBe("");
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

it.each([undefined, null, "", "new tip"])(
  "restores the current title after a recycled row changes to %s during scrolling",
  async (title) => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const wrapper = mount(VirtualList, {
      props: {
        items: [{ id: "first", title: "old tip" }],
        itemHeight: 22,
        getKey: (item) => (item as { id: string }).id,
        recycleKeys: true,
      },
      slots: {
        default: `<button class="row" :title="params.item.title">{{ params.item.id }}</button>`,
      },
    });
    try {
      const row = wrapper.get(".row").element;
      await wrapper.get(".overflow-auto").trigger("scroll");
      await wrapper.setProps({ items: [{ id: "second", title }] });
      await vi.advanceTimersByTimeAsync(1);
      expect(wrapper.get(".row").element).toBe(row);
      expect(wrapper.get(".row").text()).toBe("second");
      await vi.advanceTimersByTimeAsync(160);
      expect(row.getAttribute("title")).toBe(title ?? null);
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  },
);

it("consumes a pending title removal when the list unmounts during scrolling", async () => {
  vi.useFakeTimers();
  const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const wrapper = mount(VirtualList, {
    props: { items: ["row"], itemHeight: 22, getKey: String },
    slots: { default: `<button class="row" title="old tip">{{ params.item }}</button>` },
  });
  try {
    await wrapper.get(".overflow-auto").trigger("scroll");
    const row = wrapper.get(".row").element;
    row.removeAttribute("title");
    wrapper.unmount();
    expect(row.getAttribute("title")).toBeNull();
    expect(disconnect).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(row.getAttribute("title")).toBeNull();
  } finally {
    wrapper.unmount();
    disconnect.mockRestore();
    vi.useRealTimers();
  }
});

it("keeps the last title across multiple updates and a second scroll gesture", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const wrapper = mount(VirtualList, {
    props: { items: [{ title: "first" }], itemHeight: 22, getKey: () => "row" },
    slots: { default: `<button class="row" :title="params.item.title">row</button>` },
  });
  try {
    await wrapper.get(".overflow-auto").trigger("scroll");
    await wrapper.setProps({ items: [{ title: undefined }] });
    await wrapper.setProps({ items: [{ title: "last" }] });
    await vi.advanceTimersByTimeAsync(1);
    expect(wrapper.get(".row").attributes("title")).toBe("");
    await vi.advanceTimersByTimeAsync(160);
    expect(wrapper.get(".row").attributes("title")).toBe("last");
    await wrapper.get(".overflow-auto").trigger("scroll");
    await vi.advanceTimersByTimeAsync(160);
    expect(wrapper.get(".row").attributes("title")).toBe("last");
    expect(wrapper.get(".row").attributes("data-vl-title")).toBeUndefined();
  } finally {
    wrapper.unmount();
    vi.useRealTimers();
  }
});

it.each(["latest", undefined])(
  "flushes pending title %s before the idle timer restores it",
  async (title) => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const wrapper = mount(VirtualList, {
      props: { items: ["row"], itemHeight: 22, getKey: String },
      slots: { default: `<button class="row" title="old tip">row</button>` },
    });
    try {
      await wrapper.get(".overflow-auto").trigger("scroll");
      const row = wrapper.get(".row").element;
      if (title === undefined) row.removeAttribute("title");
      else row.setAttribute("title", title);
      // End scrolling before queued mutation callbacks are delivered.
      vi.advanceTimersByTime(151);
      expect(row.getAttribute("title")).toBe(title ?? null);
      expect(row.hasAttribute("data-vl-title")).toBe(false);
    } finally {
      wrapper.unmount();
      vi.useRealTimers();
    }
  },
);

it("renders each wheel destination on its animation frame", async () => {
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
  // A second wheel tick must not leave the viewport outside the rendered rows.
  port.scrollTop = 880;
  port.dispatchEvent(new Event("scroll"));
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  expect(wrapper.findAll(".cell").map((row) => row.text())).toContain("row-40");
  wrapper.unmount();
  vi.useRealTimers();
});

it("updates rows during a held drag but defers parent pagination until release", async () => {
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
  const initialEvents = wrapper.emitted("scroll")?.length ?? 0;
  await wrapper.get(".overflow-auto").trigger("pointerdown", { button: 0 });
  port.scrollTop = 880;
  port.dispatchEvent(new Event("scroll"));
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  expect(wrapper.findAll(".cell").map((row) => row.text())).toContain("row-40");
  expect(wrapper.emitted("scroll")?.length ?? 0).toBe(initialEvents);
  window.dispatchEvent(new Event("pointerup"));
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  expect(wrapper.findAll(".cell")[0]!.text()).not.toBe("row-0");
  expect(wrapper.emitted("scroll")?.length).toBe(initialEvents + 1);
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
  expect(firstKeys.length).toBeLessThan(60);
  port.scrollTop = 440;
  port.dispatchEvent(new Event("scroll"));
  frames.splice(0).forEach((callback) => callback(0));
  await nextTick();
  const secondKeys = wrapper.findAll(".cell").map((node) => node.text());
  expect(secondKeys[0]).not.toBe("row-0");
  expect(secondKeys.length).toBeLessThan(60);
  // Slot keys are window indices, so the mounted cell count stays a small pool.
  expect(Math.abs(secondKeys.length - firstKeys.length)).toBeLessThanOrEqual(20);
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

it("avoids redundant scrollTop writes when replacing items keeps the anchor at the same offset", async () => {
  const items = Array.from({ length: 100 }, (_, i) => `row-${i}`);
  const wrapper = mount(VirtualList, {
    props: { items, itemHeight: 22, getKey: String, preserveScrollAnchor: true },
  });
  const port = wrapper.get(".overflow-auto").element;
  let scrollTopValue = 440;
  const writes: number[] = [];
  Object.defineProperty(port, "scrollTop", {
    configurable: true,
    get: () => scrollTopValue,
    set: (value: number) => {
      writes.push(value);
      scrollTopValue = value;
    },
  });
  await wrapper.setProps({ items: [...items] });
  await flushPromises();
  expect(writes).toEqual([]);
  expect(port.scrollTop).toBe(440);
  wrapper.unmount();
});

it("keeps overlapping rows bound during small scrolls and reuses the window on large jumps", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  let renders = 0;
  const Cell = defineComponent({
    props: { row: { type: Number, required: true } },
    setup: (props) => () => {
      renders++;
      return h("button", { "data-row": props.row }, String(props.row));
    },
  });
  const wrapper = mount(VirtualList, {
    props: {
      items: Array.from({ length: 20000 }, (_, i) => i),
      itemHeight: 20,
      overscan: 16,
      getKey: Number,
      recycleKeys: true,
    },
    slots: { default: ({ item }) => h(Cell, { row: Number(item) }) },
  });
  try {
    const port = wrapper.get(".overflow-auto").element;
    const scroll = async (index: number) => {
      port.scrollTop = 20 * index;
      port.dispatchEvent(new Event("scroll"));
      frames.splice(0).forEach((callback) => callback(0));
      await nextTick();
    };
    await scroll(100);
    const middle = wrapper.get('[data-row="110"]').element;
    const capacity = wrapper.findAll("button").length;
    renders = 0;
    for (let i = 1; i <= 12; i++) await scroll(100 + i);
    expect(renders, `child renders moving 12 rows with ${capacity} rows mounted`).toBe(12);
    expect(wrapper.get('[data-row="110"]').element).toBe(middle);
    const elements = new Set(wrapper.findAll("button").map((button) => button.element));
    await scroll(8000);
    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(capacity);
    expect(buttons.every((button) => elements.has(button.element))).toBe(true);
    expect(buttons[0]!.text()).toBe("7980");
    expect(buttons.at(-1)!.text()).toBe("8040");
  } finally {
    wrapper.unmount();
  }
});
