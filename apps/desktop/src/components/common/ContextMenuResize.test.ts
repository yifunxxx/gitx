import { afterEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import ContextMenuSurface from "./ContextMenuSurface.vue";

enableAutoUnmount(afterEach);
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

it("keeps an open menu and its focused command inside the resized viewport", async () => {
  let width = 1280;
  let height = 800;
  vi.spyOn(window, "innerWidth", "get").mockImplementation(() => width);
  vi.spyOn(window, "innerHeight", "get").mockImplementation(() => height);
  const wrapper = mount(ContextMenuSurface, {
    props: { open: true, anchorX: 1200, anchorY: 780 },
    slots: {
      default: '<button role="menuitem">First</button><button role="menuitem">Last</button>',
    },
    attachTo: document.body,
  });
  await flushPromises();
  const panel = document.querySelector<HTMLElement>('[role="menu"]')!;
  Object.defineProperties(panel, {
    offsetWidth: { value: 240 },
    scrollWidth: { value: 240 },
    offsetHeight: { value: 96 },
    scrollHeight: { value: 96 },
    clientHeight: { value: 96 },
  });
  await wrapper.setProps({ anchorX: 1199 });
  await flushPromises();
  expect(parseFloat(panel.style.left) + 240).toBeLessThanOrEqual(width - 10);
  expect(parseFloat(panel.style.top) + parseFloat(panel.style.maxHeight)).toBeLessThanOrEqual(
    height - 10,
  );
  const selected = panel.querySelectorAll("button")[1]!;
  selected.focus();
  width = 900;
  height = 600;
  window.dispatchEvent(new Event("resize"));
  await flushPromises();
  expect(parseFloat(panel.style.left) + 240).toBeLessThanOrEqual(width - 10);
  expect(parseFloat(panel.style.top) + parseFloat(panel.style.maxHeight)).toBeLessThanOrEqual(
    height - 10,
  );
  expect(document.activeElement).toBe(selected);
  expect(wrapper.emitted("close")).toBeUndefined();

  width = 1280;
  height = 800;
  window.dispatchEvent(new Event("resize"));
  await flushPromises();
  expect(parseFloat(panel.style.left)).toBe(1030);
  expect(parseFloat(panel.style.maxHeight)).toBe(96);
  expect(document.activeElement).toBe(selected);
});

it("releases its viewport listener when the menu closes or unmounts", async () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const wrapper = mount(ContextMenuSurface, {
    props: { open: false, anchorX: 50, anchorY: 50 },
    attachTo: document.body,
  });
  expect(add.mock.calls.filter(([name]) => name === "resize")).toHaveLength(0);
  remove.mockClear();
  await wrapper.setProps({ open: true });
  await flushPromises();
  const listeners = add.mock.calls.filter(([name]) => name === "resize");
  expect(listeners).toHaveLength(1);
  await wrapper.setProps({ open: false });
  expect(remove).toHaveBeenCalledWith("resize", listeners[0]![1]);
  await wrapper.setProps({ open: true });
  wrapper.unmount();
  await flushPromises();
  const added = add.mock.calls.filter(([name]) => name === "resize");
  const removed = remove.mock.calls.filter(([name]) => name === "resize");
  expect(added).toHaveLength(2);
  expect(removed).toHaveLength(2);
});
