import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import VirtualList from "./VirtualList.vue";

let frames: FrameRequestCallback[];
beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function list() {
  const wrapper = mount(VirtualList, {
    props: {
      items: Array.from({ length: 1000 }, (_, i) => `row-${i}`),
      itemHeight: 22,
      getKey: String,
      overscan: 2,
      recycleKeys: true,
    },
    slots: { default: '<span class="cell">{{ params.item }}</span>' },
  });
  const port = wrapper.get(".overflow-auto");
  Object.defineProperty(port.element, "clientHeight", { configurable: true, value: 400 });
  return { wrapper, port };
}
async function paint() {
  frames.splice(0).forEach((callback) => callback(performance.now()));
  await nextTick();
}

it.each([-400, 400])("keeps a native %spx move covered before its scroll event", async (delta) => {
  const { wrapper, port } = list();
  try {
    port.element.scrollTop = 11000;
    await port.trigger("scroll");
    await paint();
    // The compositor can move the viewport before the main-thread scroll
    // handler runs. The previous row window must already cover this position.
    port.element.scrollTop += delta;
    const rows = wrapper.findAll(".cell").map((row) => Number(row.text().slice(4)));
    expect(rows[0]! * 22).toBeLessThanOrEqual(port.element.scrollTop);
    expect((rows.at(-1)! + 1) * 22).toBeGreaterThanOrEqual(port.element.scrollTop + 400);
    expect(rows.length).toBeLessThan(60);
    expect(new Set(rows).size).toBe(rows.length);
  } finally {
    wrapper.unmount();
  }
});

it("buffers variable-height rows by viewport pixels while keeping tall rows bounded", async () => {
  const { wrapper, port } = list();
  try {
    const items = Array.from({ length: 10000 }, (_, i) => `row-${i}`);
    await wrapper.setProps({ items, getItemHeight: () => 200 });
    port.element.scrollTop = 10000;
    await port.trigger("scroll");
    await paint();
    const rows = wrapper.findAll(".cell").map((row) => Number(row.text().slice(4)));
    expect(rows[0]! * 200).toBeLessThanOrEqual(9600);
    expect((rows.at(-1)! + 1) * 200).toBeGreaterThanOrEqual(10800);
    expect(rows.length).toBeLessThan(10);
  } finally {
    wrapper.unmount();
  }
});

it("resizes the buffer and recycled pool without losing or duplicating destination rows", async () => {
  let resize: (() => void) | undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const { wrapper, port } = list();
  try {
    port.element.scrollTop = 11000;
    await port.trigger("scroll");
    await paint();
    for (const height of [704, 220]) {
      Object.defineProperty(port.element, "clientHeight", { configurable: true, value: height });
      resize!();
      await nextTick();
      const rows = wrapper.findAll(".cell").map((row) => Number(row.text().slice(4)));
      expect(rows[0]! * 22).toBeLessThanOrEqual(11000 - height);
      expect((rows.at(-1)! + 1) * 22).toBeGreaterThanOrEqual(11000 + 2 * height);
      expect(rows.length).toBeLessThanOrEqual(3 * Math.ceil(height / 22) + 1);
      expect(new Set(rows).size).toBe(rows.length);
    }
  } finally {
    wrapper.unmount();
  }
});

it.each([false, true])(
  "updates exposed rows before the next animation frame (dragging=%s)",
  async (dragging) => {
    const { wrapper, port } = list();
    try {
      if (dragging) await port.trigger("pointerdown", { button: 0 });
      // Native scrolling has already moved beyond the old overscan. Holding
      // rAF must not leave the destination empty until parent pagination runs.
      port.element.scrollTop = 11000;
      await port.trigger("scroll");
      expect(wrapper.findAll(".cell").map((row) => row.text())).toContain("row-500");
      expect(wrapper.findAll(".cell").length).toBeLessThan(60);
      expect(wrapper.emitted("scroll")).toBeUndefined();
      expect(frames).toHaveLength(1);
      await paint();
      expect(wrapper.emitted("scroll")?.length ?? 0).toBe(dragging ? 0 : 1);
    } finally {
      wrapper.unmount();
    }
  },
);

it("renders the latest of coalesced scroll events before parent notification", async () => {
  const { wrapper, port } = list();
  try {
    for (const top of [440, 2200, 11000]) {
      port.element.scrollTop = top;
      port.element.dispatchEvent(new Event("scroll"));
    }
    await nextTick();
    expect(wrapper.findAll(".cell").map((row) => row.text())).toContain("row-500");
    expect(wrapper.emitted("scroll")).toBeUndefined();
    expect(frames).toHaveLength(1);
    await paint();
    expect(wrapper.emitted("scroll")).toHaveLength(1);
  } finally {
    wrapper.unmount();
  }
});

it("renders the destination during a held scrollbar drag", async () => {
  const { wrapper, port } = list();
  try {
    await port.trigger("pointerdown", { button: 0 });
    port.element.scrollTop = 11000;
    await port.trigger("scroll");
    await paint();
    expect(wrapper.findAll(".cell").map((row) => row.text())).toContain("row-500");
    expect(wrapper.findAll(".cell").length).toBeLessThan(60);
  } finally {
    wrapper.unmount();
  }
});

it("updates a second wheel destination on the next animation frame", async () => {
  const { wrapper, port } = list();
  try {
    await port.trigger("scroll");
    await paint();
    port.element.scrollTop = 11000;
    await port.trigger("scroll");
    await paint();
    expect(wrapper.findAll(".cell").map((row) => row.text())).toContain("row-500");
  } finally {
    wrapper.unmount();
  }
});

it("never replays an old wheel position after explicit navigation", async () => {
  const { wrapper, port } = list();
  try {
    await port.trigger("scroll");
    await paint();
    port.element.scrollTop = 11000;
    await port.trigger("scroll");
    await paint();
    (wrapper.vm as unknown as { scrollToIndex: (index: number) => void }).scrollToIndex(900);
    await nextTick();
    const destination = port.element.scrollTop;
    await vi.advanceTimersByTimeAsync(60);
    await paint();
    expect(port.element.scrollTop).toBe(destination);
    expect(wrapper.findAll(".cell").map((row) => row.text())).toContain("row-900");
  } finally {
    wrapper.unmount();
  }
});

it("coalesces scroll bursts and reads the latest port position", async () => {
  const { wrapper, port } = list();
  try {
    for (const top of [440, 2200, 11000]) {
      port.element.scrollTop = top;
      await port.trigger("scroll");
    }
    expect(frames).toHaveLength(1);
    await paint();
    expect(wrapper.findAll(".cell").map((row) => row.text())).toContain("row-500");
    expect(wrapper.emitted("scroll")).toHaveLength(1);
    expect((wrapper.emitted("scroll")![0]![0] as Event).target).toBe(port.element);
  } finally {
    wrapper.unmount();
  }
});

it("cancels pending work and ignores released gestures after unmount", async () => {
  const { wrapper, port } = list();
  await port.trigger("pointerdown", { button: 0 });
  port.element.scrollTop = 11000;
  await port.trigger("scroll");
  wrapper.unmount();
  expect(cancelAnimationFrame).toHaveBeenCalled();
  window.dispatchEvent(new Event("pointerup"));
  await paint();
  await vi.advanceTimersByTimeAsync(200);
  expect(wrapper.emitted("scroll")).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  { label: "an inserted item", inserted: ["new-file"] },
  { label: "expanded children", inserted: ["child-a", "child-b", "child-c"] },
])(
  "preserves the visible row when $label precede it after an unchanged head",
  async ({ inserted }) => {
    const { wrapper, port } = list();
    try {
      await wrapper.setProps({ preserveScrollAnchor: true });
      port.element.scrollTop = 11007;
      await port.trigger("scroll");
      await paint();
      const items = [...(wrapper.props("items") as string[])];
      items.splice(20, 0, ...inserted);
      await wrapper.setProps({ items });
      await nextTick();
      expect(port.element.scrollTop).toBe(11007 + inserted.length * 22);
      expect(wrapper.findAll(".cell").map((row) => row.text())).toContain("row-500");
    } finally {
      wrapper.unmount();
    }
  },
);

it("keeps append anchoring bounded without scanning all existing row keys", async () => {
  const { wrapper, port } = list();
  try {
    const items = Array.from({ length: 20000 }, (_, i) => `row-${i}`);
    const getKey = vi.fn((item: unknown) => String(item));
    await wrapper.setProps({ items, getKey, preserveScrollAnchor: true });
    port.element.scrollTop = 220007;
    await port.trigger("scroll");
    await paint();
    getKey.mockClear();
    await wrapper.setProps({ items: [...items, "appended"] });
    await nextTick();
    expect(port.element.scrollTop).toBe(220007);
    expect(wrapper.findAll(".cell").map((row) => row.text())).toContain("row-10000");
    // Includes visible row rendering; a prefix verification or findIndex scan
    // through the 10,000-row anchor would violate this bounded work check.
    expect(getKey.mock.calls.length).toBeLessThan(100);
  } finally {
    wrapper.unmount();
  }
});

it("keeps pixel scrolling when anchoring is disabled and rows grow before the viewport", async () => {
  const { wrapper, port } = list();
  try {
    port.element.scrollTop = 11007;
    await port.trigger("scroll");
    await paint();
    const items = [...(wrapper.props("items") as string[])];
    items.splice(20, 0, "new-file");
    await wrapper.setProps({ items });
    await nextTick();
    expect(port.element.scrollTop).toBe(11007);
  } finally {
    wrapper.unmount();
  }
});
