import { expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import VirtualList from "./VirtualList.vue";

it("keeps the visible commit in place when newer history is prepended", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
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
  vi.unstubAllGlobals();
});
