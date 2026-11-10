import { beforeEach, expect, it } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, onMounted } from "vue";
import { Splitpanes } from "splitpanes";
import WorkspacePanels from "./WorkspacePanels.vue";
import { useLayoutStore } from "@/stores/layoutStore";

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

it("maximizes and restores real panes repeatedly without recreating their content", async () => {
  let mounts = 0;
  const content = defineComponent({
    setup() {
      onMounted(() => mounts++);
      return () => h("input");
    },
  });
  const wrapper = mount(WorkspacePanels, { slots: { editor: content, git: content } });
  const layout = useLayoutStore();
  await flushPromises();
  const sizes = () =>
    wrapper.findAll(".splitpanes__pane").map((pane) => (pane.element as HTMLElement).style.height);
  expect(sizes()).toEqual(["68%", "32%"]);
  wrapper
    .findComponent(Splitpanes)
    .vm.$emit("resized", { event: new Event("mouseup"), panes: [{ size: 56 }, { size: 44 }] });
  await flushPromises();
  for (let i = 0; i < 3; i++) {
    layout.bottomMaximized = true;
    await flushPromises();
    expect(sizes()).toEqual(["0%", "100%"]);
    expect(wrapper.findAll(".splitpanes__pane")[0]!.attributes("inert")).toBeDefined();
    layout.bottomMaximized = false;
    await flushPromises();
    expect(sizes()).toEqual(["56%", "44%"]);
  }
  expect(mounts).toBe(2);
  expect(layout.bottomSize).toBe(44);
  wrapper.unmount();
});

it("uses the same maximize state for divider double-click and handles hide/reopen", async () => {
  const wrapper = mount(WorkspacePanels, { slots: { editor: "editor", git: "git" } });
  await flushPromises();
  const layout = useLayoutStore();
  await wrapper.get(".splitpanes__splitter").trigger("dblclick");
  await flushPromises();
  expect(layout.bottomMaximized).toBe(true);
  expect((wrapper.findAll(".splitpanes__pane")[1]!.element as HTMLElement).style.height).toBe(
    "100%",
  );
  layout.bottomOpen = false;
  await flushPromises();
  expect((wrapper.findAll(".splitpanes__pane")[0]!.element as HTMLElement).style.height).toBe(
    "100%",
  );
  layout.bottomOpen = true;
  await flushPromises();
  expect((wrapper.findAll(".splitpanes__pane")[1]!.element as HTMLElement).style.height).toBe(
    "100%",
  );
  layout.bottomMaximized = false;
  await flushPromises();
  expect((wrapper.findAll(".splitpanes__pane")[1]!.element as HTMLElement).style.height).toBe(
    "32%",
  );
  wrapper.unmount();
});
