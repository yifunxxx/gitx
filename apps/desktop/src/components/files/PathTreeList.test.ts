import { afterEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PathTreeList from "./PathTreeList.vue";

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
