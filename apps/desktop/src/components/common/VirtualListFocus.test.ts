import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { h, nextTick } from "vue";
import VirtualList from "./VirtualList.vue";

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function list() {
  const activate = vi.fn();
  const items = Array.from({ length: 1000 }, (_, id) => ({ id, label: `row-${id}` }));
  const wrapper = mount(VirtualList, {
    attachTo: document.body,
    props: {
      items,
      itemHeight: 20,
      getKey: (item: any) => item.id,
      recycleKeys: true,
      overscan: 2,
    },
    slots: {
      default: ({ item }: any) =>
        h("button", { "data-row": item.id, onClick: () => activate(item.id) }, item.label),
    },
  });
  const port = wrapper.get(".overflow-auto");
  Object.defineProperty(port.element, "clientHeight", { configurable: true, value: 400 });
  const focused = wrapper.get<HTMLButtonElement>('[data-row="5"]').element;
  focused.focus();
  expect(document.activeElement).toBe(focused);
  return { wrapper, port, focused, activate, items };
}

it("moves focus to the scrollport before a focused button is recycled for another row", async () => {
  const { wrapper, port, focused, activate } = list();
  port.element.scrollTop = 5000;
  await port.trigger("scroll");
  expect(wrapper.findAll("button").length).toBeLessThan(65);
  expect(document.activeElement).toBe(port.element);
  expect(document.activeElement).not.toBe(focused);
  (document.activeElement as HTMLElement).click();
  expect(activate).not.toHaveBeenCalled();
  expect(port.element.scrollTop).toBe(5000);
});

it("does not transfer focus to a replacement at the same index after a background refresh", async () => {
  const { wrapper, port, items, activate } = list();
  await wrapper.setProps({ items: items.map((item) => ({ ...item, id: item.id + 1000 })) });
  expect(document.activeElement).toBe(port.element);
  (document.activeElement as HTMLElement).click();
  expect(activate).not.toHaveBeenCalled();
});

it("keeps focus and activation on the same row through overlapping scrolls and fresh objects", async () => {
  const { wrapper, port, focused, items, activate } = list();
  port.element.scrollTop = 20;
  await port.trigger("scroll");
  await wrapper.setProps({
    items: items.map((item) => ({ ...item, label: `${item.label} refreshed` })),
  });
  expect(document.activeElement).toBe(focused);
  focused.click();
  expect(activate).toHaveBeenCalledExactlyOnceWith(5);
});

it("retains a keyboard destination when the focused row is removed from the pool", async () => {
  const { wrapper, port, items } = list();
  await wrapper.setProps({ items: items.slice(0, 2) });
  expect(document.activeElement).toBe(port.element);
});

it("does not steal focus from a filter or open menu when rows are recycled", async () => {
  const { wrapper, port, items } = list();
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  port.element.scrollTop = 5000;
  await port.trigger("scroll");
  await wrapper.setProps({ items: items.slice(0, 20) });
  expect(document.activeElement).toBe(input);
});

it("does not refocus a disappearing list during component unmount", async () => {
  const { wrapper, port } = list();
  const focus = vi.spyOn(port.element as HTMLElement, "focus");
  wrapper.unmount();
  await nextTick();
  expect(focus).not.toHaveBeenCalled();
});

it("preserves an explicitly configured scrollport tab order", async () => {
  const { wrapper, port } = list();
  await wrapper.setProps({ scrollTabindex: 0 });
  expect(port.attributes("tabindex")).toBe("0");
});

it("leaves the native scrollport tab behavior unchanged when recycling is disabled", async () => {
  const { wrapper, port } = list();
  await wrapper.setProps({ recycleKeys: false });
  expect(port.attributes("tabindex")).toBeUndefined();
});
