import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import ShelfFiles from "./ShelfFiles.vue";

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
afterEach(() => vi.unstubAllGlobals());

it("bounds mounted rows for large shelves and reaches the first and last path by keyboard", async () => {
  const paths = Array.from({ length: 10000 }, (_, i) => `目录 ${i}/file ${i}.txt`);
  const wrapper = mount(ShelfFiles, { props: { paths, label: "Saved files" } });
  expect(wrapper.findAll('[role="listitem"]').length).toBeLessThan(30);
  expect(wrapper.get('[role="listitem"]').attributes("title")).toBe(paths[0]);
  await wrapper.trigger("keydown", { key: "End" });
  const last = wrapper.findAll('[role="listitem"]').at(-1)!;
  expect(last.attributes("title")).toBe(paths.at(-1));
  expect(last.attributes("aria-posinset")).toBe("10000");
  expect(last.attributes("aria-setsize")).toBe("10000");
  expect(wrapper.findAll('[role="listitem"]').length).toBeLessThan(30);
  await wrapper.trigger("keydown", { key: "Home" });
  expect(wrapper.get('[role="listitem"]').attributes("title")).toBe(paths[0]);
});

it("clamps a scrolled list when partial application removes most files", async () => {
  const wrapper = mount(ShelfFiles, {
    props: { paths: Array.from({ length: 1000 }, (_, i) => `file${i}`), label: "Saved files" },
  });
  await wrapper.trigger("keydown", { key: "End" });
  await wrapper.setProps({ paths: ["remaining.txt"] });
  await flushPromises();
  expect(wrapper.findAll('[role="listitem"]')).toHaveLength(1);
  expect(wrapper.get('[role="listitem"]').text()).toBe("remaining.txt");
});

it("allows Escape or left arrow to return to the Shelf row", async () => {
  const wrapper = mount(ShelfFiles, { props: { paths: ["a.txt"], label: "Saved files" } });
  await wrapper.trigger("keydown", { key: "ArrowLeft", isComposing: true });
  expect(wrapper.emitted("collapse")).toBeUndefined();
  await wrapper.trigger("keydown", { key: "ArrowLeft" });
  await wrapper.trigger("keydown", { key: "Escape" });
  expect(wrapper.emitted("collapse")).toHaveLength(2);
});
