import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import PathChecklist, { type PathChecklistItem } from "./PathChecklist.vue";
import VirtualList from "./VirtualList.vue";

vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
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

function setup(files: PathChecklistItem[], initial: string[] = []) {
  const wrapper = mount(PathChecklist, {
    props: {
      files,
      modelValue: initial,
      "onUpdate:modelValue": (paths) => wrapper.setProps({ modelValue: paths }),
    },
    attachTo: document.body,
  });
  const box = (path: string) => wrapper.get<HTMLInputElement>(`input[aria-label="${path}"]`);
  const row = (path: string) => wrapper.get(`[data-path="${path}"]`);
  const selection = () => wrapper.props("modelValue");
  const mode = () => wrapper.get("[data-list-mode]").trigger("click");
  return { wrapper, box, row, selection, mode };
}

const files = [
  { path: "src/a.ts", status: "M" },
  { path: "src/nested/b.ts", status: "A" },
  { path: "src/nested/c.ts", status: "M" },
  { path: "other/d.ts", status: "D" },
];

it("keeps the flat default and preserves selection across modes and folder toggles", async () => {
  const f = setup(files, ["src/a.ts", "other/d.ts"]);
  expect(f.wrapper.find('[role="tree"]').exists()).toBe(false);
  expect(f.box("src/a.ts").element.checked).toBe(true);
  await f.mode();
  expect(f.row("src").attributes("aria-checked")).toBe("mixed");
  expect(f.box("src").element.indeterminate).toBe(true);
  await f.box("src").setValue(true);
  expect(new Set(f.selection())).toEqual(new Set(files.map((file) => file.path)));
  expect(f.row("src").attributes("aria-checked")).toBe("true");
  await f.box("src").setValue(false);
  expect(f.selection()).toEqual(["other/d.ts"]);
  await f.mode();
  expect(f.wrapper.find('[role="tree"]').exists()).toBe(false);
  expect(f.box("other/d.ts").element.checked).toBe(true);
  expect(f.box("src/a.ts").element.checked).toBe(false);
});

it("checks nested descendants even while a folder is collapsed without selecting siblings", async () => {
  const f = setup(files);
  await f.mode();
  await f.row("src/nested").get("button").trigger("click");
  expect(f.wrapper.find('[data-path="src/nested/b.ts"]').exists()).toBe(false);
  await f.box("src/nested").setValue(true);
  expect(f.selection()).toEqual(["src/nested/b.ts", "src/nested/c.ts"]);
  expect(f.row("src").attributes("aria-checked")).toBe("mixed");
  await f.row("src/nested").get("button").trigger("click");
  expect(f.box("src/nested/b.ts").element.checked).toBe(true);
  expect(f.box("src/nested/c.ts").element.checked).toBe(true);
});

it("filters renamed paths in tree mode and limits folder checks to matching files", async () => {
  const f = setup(
    [
      { path: "src/new.ts", origPath: "old/needle.ts", status: "R" },
      { path: "src/hidden.ts", status: "M" },
      { path: "outside.ts", status: "M" },
    ],
    ["outside.ts"],
  );
  await f.mode();
  await f.row("src").get("button").trigger("click");
  await f.wrapper.get('input[type="search"]').setValue("needle");
  expect(f.row("src").attributes("aria-expanded")).toBe("true");
  expect(f.wrapper.find('[data-path="src/new.ts"]').exists()).toBe(true);
  expect(f.wrapper.find('[data-path="src/hidden.ts"]').exists()).toBe(false);
  await f.box("src").setValue(true);
  expect(f.selection()).toEqual(["outside.ts", "src/new.ts"]);
  await f.wrapper.get('input[type="search"]').setValue("");
  expect(f.row("src").attributes("aria-checked")).toBe("mixed");
  expect(f.box("src/hidden.ts").element.checked).toBe(false);
  await f.mode();
  expect(f.box("old/needle.ts → src/new.ts").element.checked).toBe(true);
});

it("returns real directory leaves and file paths rather than synthetic folder paths", async () => {
  const f = setup([{ path: "new/" }, { path: "src/a.ts" }, { path: "src/nested/b.ts" }]);
  await f.mode();
  await f.box("new/").setValue(true);
  await f.box("src").setValue(true);
  expect(new Set(f.selection())).toEqual(new Set(["new/", "src/a.ts", "src/nested/b.ts"]));
  expect(f.selection()).not.toContain("src");
});

it.each(["", "src/"])(
  "keeps a deleted file and its replacement directory independently selectable under %s",
  async (prefix) => {
    const oldPath = `${prefix}replacement`;
    const first = `${oldPath}/first.txt`;
    const second = `${oldPath}/second.txt`;
    const outside = `${prefix}sibling.txt`;
    const candidates = [
      { path: oldPath, status: "D" },
      { path: first, status: "A" },
      { path: second, status: "A" },
      { path: outside, status: "M" },
    ];
    const allPaths = candidates.map((file) => file.path);
    const f = setup(candidates, allPaths);
    await f.mode();
    const folder = () => f.wrapper.get(`[data-path="${oldPath}"][aria-expanded]`);
    const oldFile = () => f.wrapper.get(`[data-path="${oldPath}"]:not([aria-expanded])`);
    const oldBox = () => oldFile().get<HTMLInputElement>('input[type="checkbox"]');
    const folderBox = () => folder().get<HTMLInputElement>('input[type="checkbox"]');
    const listProps = f.wrapper.findComponent(VirtualList).props() as { items: { key: string }[] };
    const keys = listProps.items.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(oldFile().text()).toContain("D");
    await oldBox().setValue(false);
    expect(new Set(f.selection())).toEqual(new Set([first, second, outside]));
    expect(folder().attributes("aria-checked")).toBe("true");
    if (prefix) expect(f.row("src").attributes("aria-checked")).toBe("mixed");
    await f.box(first).setValue(false);
    expect(folder().attributes("aria-checked")).toBe("mixed");
    await folderBox().setValue(true);
    expect(new Set(f.selection())).toEqual(new Set([first, second, outside]));
    expect(oldBox().element.checked).toBe(false);
    await folder().get("button").trigger("click");
    expect(oldFile().isVisible()).toBe(true);
    await folderBox().setValue(false);
    expect(f.selection()).toEqual([outside]);
    await oldBox().setValue(true);
    expect(new Set(f.selection())).toEqual(new Set([oldPath, outside]));
    if (prefix) {
      await f.box("src").setValue(true);
      expect(new Set(f.selection())).toEqual(new Set(allPaths));
      await oldBox().setValue(false);
    }
    const beforeSwitch = [...f.selection()];
    await f.mode();
    expect(f.wrapper.findAll("[data-path]")).toHaveLength(candidates.length);
    expect(f.selection()).toEqual(beforeSwitch);
    expect(f.box(oldPath).element.checked).toBe(beforeSwitch.includes(oldPath));
    await f.mode();
    expect(oldBox().element.checked).toBe(beforeSwitch.includes(oldPath));
    expect(f.selection()).toEqual(beforeSwitch);
  },
);

it("navigates expanded and collapsed folders with arrow keys and keeps checkbox focus", async () => {
  const f = setup(files);
  await f.mode();
  f.box("src").element.focus();
  await f.box("src").trigger("keydown", { key: "ArrowRight" });
  await flushPromises();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("src/nested");
  await f.box("src/nested").trigger("keydown", { key: "ArrowRight" });
  await flushPromises();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("src/nested/b.ts");
  await f.box("src/nested/b.ts").trigger("keydown", { key: "ArrowLeft" });
  await flushPromises();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("src/nested");
  await f.box("src/nested").trigger("keydown", { key: "ArrowLeft" });
  expect(f.row("src/nested").attributes("aria-expanded")).toBe("false");
  await f.box("src/nested").trigger("keydown", { key: "ArrowLeft" });
  await flushPromises();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("src");
  expect(f.selection()).toEqual([]);
});

it("does not intercept composed or modified navigation and disables tree selection controls", async () => {
  const f = setup(files, ["src/a.ts"]);
  await f.mode();
  for (const init of [
    { isComposing: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
  ]) {
    const event = new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      bubbles: true,
      cancelable: true,
      ...init,
    });
    f.box("src").element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  await f.wrapper.setProps({ disabled: true });
  expect(f.box("src").element.disabled).toBe(true);
  expect(f.row("src").get("button").attributes("disabled")).toBeDefined();
  expect(f.wrapper.get("[data-list-mode]").attributes("disabled")).toBeDefined();
  await f.box("src").trigger("change");
  await f.box("src").trigger("keydown", { key: "ArrowLeft" });
  expect(f.selection()).toEqual(["src/a.ts"]);
  expect(f.row("src").attributes("aria-expanded")).toBe("true");
});

it("keeps large trees virtual and scrolls to the keyboard destination before focusing", async () => {
  const many = Array.from({ length: 2000 }, (_, i) => ({
    path: `src/file-${String(i).padStart(4, "0")}.ts`,
  }));
  const f = setup(many);
  await f.mode();
  expect(f.wrapper.findAll('[role="treeitem"]').length).toBeLessThan(50);
  await f.box("src").trigger("keydown", { key: "End" });
  await flushPromises();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("src/file-1999.ts");
  expect(f.wrapper.findAll('[role="treeitem"]').length).toBeLessThan(50);
  await f.box("src/file-1999.ts").setValue(true);
  await f.box("src/file-1999.ts").trigger("keydown", { key: "Home" });
  await flushPromises();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("src");
  expect(f.box("src").element.indeterminate).toBe(true);
});

it("prunes removed candidates while retaining selection and folder states for current files", async () => {
  const f = setup(files, ["src/a.ts", "src/nested/b.ts", "other/d.ts"]);
  await f.mode();
  await f.wrapper.setProps({ files: [{ path: "src/nested/b.ts" }, { path: "src/nested/new.ts" }] });
  await nextTick();
  expect(f.selection()).toEqual(["src/nested/b.ts"]);
  expect(f.box("src/nested").element.indeterminate).toBe(true);
  expect(f.wrapper.find('[data-path="src/a.ts"]').exists()).toBe(false);
});

it("selects all filtered descendants despite collapse and clears the complete selection", async () => {
  const f = setup(files, ["other/d.ts"]);
  await f.mode();
  await f.wrapper.get('input[type="search"]').setValue("src/");
  await f.row("src").get("button").trigger("click");
  await f.wrapper
    .findAll("button")
    .find((button) => button.text() === "rewrite.selectVisible")!
    .trigger("click");
  expect(new Set(f.selection())).toEqual(new Set(files.map((file) => file.path)));
  await f.wrapper
    .findAll("button")
    .find((button) => button.text() === "rewrite.clearSelection")!
    .trigger("click");
  expect(f.selection()).toEqual([]);
});

it("retains a keyboard entry when scrolling removes the active checkbox from the viewport", async () => {
  const many = Array.from({ length: 2000 }, (_, i) => ({
    path: `src/file-${String(i).padStart(4, "0")}.ts`,
  }));
  const f = setup(many);
  await f.mode();
  let paint: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    paint = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const port = f.wrapper.get<HTMLElement>(".overflow-auto");
  port.element.scrollTop = 36000;
  await port.trigger("scroll");
  paint?.(performance.now());
  await nextTick();
  expect(f.wrapper.find('input[aria-label="src"]').exists()).toBe(false);
  const tree = f.wrapper.get<HTMLElement>('[role="tree"]');
  expect(tree.attributes("tabindex")).toBe("0");
  tree.element.focus();
  await flushPromises();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("src");
});
