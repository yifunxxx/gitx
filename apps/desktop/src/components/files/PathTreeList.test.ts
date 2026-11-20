import { afterEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PathTreeList from "./PathTreeList.vue";
import VirtualList from "@/components/common/VirtualList.vue";

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(() => vi.unstubAllGlobals());

it("toggles a directory once per double-click and supports Enter/Space without opening a file", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const wrapper = mount(PathTreeList, { props: { files: [{ path: "src/example.ts" }] } });
  const folder = wrapper.findAll('[tabindex="0"]')[0]!;
  expect(wrapper.text()).toContain("example.ts");
  await folder.trigger("click", { detail: 1 });
  await folder.trigger("click", { detail: 2 });
  await folder.trigger("dblclick");
  expect(wrapper.text()).not.toContain("example.ts");
  await folder.trigger("keydown", { key: "Enter" });
  expect(wrapper.text()).toContain("example.ts");
  await folder.trigger("keydown", { key: " " });
  expect(wrapper.text()).not.toContain("example.ts");
  // Native button key handling must not also activate its parent row.
  await folder.get("button").trigger("keydown", { key: "Enter" });
  expect(wrapper.text()).not.toContain("example.ts");
  await folder.get("button").trigger("click");
  const file = wrapper.findAll('[tabindex="0"]')[1]!;
  await file.trigger("keydown", { key: " " });
  expect(wrapper.emitted("select")).toMatchObject([[{ path: "src/example.ts" }]]);
  expect(wrapper.emitted("open")).toBeUndefined();
  await file.trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("open")).toMatchObject([[{ path: "src/example.ts" }]]);
  wrapper.unmount();
});

it("renders flat full paths without folder rows", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const wrapper = mount(PathTreeList, {
    props: {
      mode: "flat",
      files: [{ path: "src/example.ts" }, { path: "README.md" }],
    },
  });
  const labels = wrapper.findAll('[tabindex="0"]').map((row) => row.text());
  expect(labels).toEqual(["README.md", "src/example.ts"]);
  expect(wrapper.find("button").exists()).toBe(false);
  wrapper.unmount();
});

it("keeps replacement files selectable and openable when their same-name folder is collapsed", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const oldFile = { path: "replacement", status: "D" };
  const child = { path: "replacement/new.txt", status: "A" };
  const wrapper = mount(PathTreeList, { props: { files: [oldFile, child] } });
  try {
    const virtual = wrapper.findComponent(VirtualList).props() as {
      items: unknown[];
      getKey: (row: unknown) => string;
    };
    const keys = virtual.items.map(virtual.getKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(wrapper.findAll('[tabindex="0"]')).toHaveLength(3);
    await wrapper.get("button").trigger("click");
    const rows = wrapper.findAll('[tabindex="0"]');
    expect(rows).toHaveLength(2);
    const file = rows[1]!;
    await file.trigger("click");
    await file.trigger("dblclick");
    await file.trigger("contextmenu", { clientX: 17, clientY: 23 });
    expect(wrapper.emitted("select")?.at(-1)).toMatchObject([oldFile]);
    expect(wrapper.emitted("open")?.at(-1)).toMatchObject([oldFile]);
    expect(wrapper.emitted("context")?.at(-1)).toMatchObject([{ file: oldFile, x: 17, y: 23 }]);
    await file.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("open")).toHaveLength(2);
    await wrapper.setProps({ mode: "flat" });
    expect(wrapper.findAll('[tabindex="0"]').map((row) => row.text())).toEqual([
      "replacement",
      "replacement/new.txt",
    ]);
    await wrapper.setProps({ mode: "tree", files: [child, { ...oldFile }] });
    expect(wrapper.findAll('[tabindex="0"]')).toHaveLength(2);
    await wrapper.get("button").trigger("click");
    await wrapper.findAll('[tabindex="0"]')[1]!.trigger("dblclick");
    expect(wrapper.emitted("open")?.at(-1)).toMatchObject([child]);
  } finally {
    wrapper.unmount();
  }
});
