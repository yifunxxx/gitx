import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import ShelfList from "./ShelfList.vue";
import VirtualList from "@/components/common/VirtualList.vue";

const mocks = vi.hoisted(() => ({ store: {} as any, workspace: {} as any }));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => mocks.store }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const shelf = (id: string) => ({ id, message: id, paths: [`${id}.txt`] });
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  mocks.workspace = reactive({ isRepo: true, repoPath: "A", navigationToken: () => 0 });
  mocks.store = reactive({
    shelves: [shelf("first"), shelf("second"), shelf("third")],
    deletedShelves: [shelf("deleted"), shelf("other")],
    showDeleted: true,
    selectedShelfId: null,
    selectedDeletedShelfId: null,
    busy: false,
    repositoryToken: () => 0,
    setShowDeleted: vi.fn(),
    restoreShelf: vi.fn(),
    unshelve: vi.fn(),
    promptRenameShelf: vi.fn(),
    promptExportShelf: vi.fn(),
    deleteShelf: vi.fn(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
const create = () => mount(ShelfList, { attachTo: document.body });
const menuItems = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));

it("keeps selection exclusive and double click does not apply or restore", async () => {
  const wrapper = create();
  const active = wrapper.findAll('[data-entry="shelf"]');
  const deleted = wrapper.findAll('[data-entry="deleted-shelf"]');
  await active[0]!.trigger("click");
  await active[0]!.trigger("dblclick");
  expect(mocks.store.selectedShelfId).toBe("first");
  await deleted[0]!.trigger("click");
  await deleted[0]!.trigger("dblclick");
  expect(mocks.store.selectedDeletedShelfId).toBe("deleted");
  expect(mocks.store.selectedShelfId).toBeNull();
  expect(deleted[0]!.attributes("aria-pressed")).toBe("true");
  expect(mocks.store.unshelve).not.toHaveBeenCalled();
  expect(mocks.store.restoreShelf).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("shelf.restoreHint");
  await active[1]!.trigger("click");
  expect(mocks.store.selectedDeletedShelfId).toBeNull();
  expect(mocks.store.selectedShelfId).toBe("second");
});

it.each(["shelf", "deleted-shelf"])("navigates %s with arrows, Home and End", async (section) => {
  const wrapper = create();
  const rows = wrapper.findAll(`[data-entry="${section}"]`);
  await rows[0]!.trigger("keydown", { key: "End" });
  expect(document.activeElement).toBe(rows.at(-1)!.element);
  expect(rows.at(-1)!.attributes("tabindex")).toBe("0");
  await rows.at(-1)!.trigger("keydown", { key: "ArrowUp" });
  expect(document.activeElement).toBe(rows.at(-2)!.element);
  await rows.at(-2)!.trigger("keydown", { key: "Home" });
  expect(document.activeElement).toBe(rows[0]!.element);
  await rows[0]!.trigger("keydown", { key: "ArrowDown" });
  expect(document.activeElement).toBe(rows[1]!.element);
});

it("uses a stable active ID for context actions after reordering", async () => {
  const wrapper = create();
  await wrapper
    .findAll('[data-entry="shelf"]')[1]!
    .trigger("contextmenu", { clientX: 30, clientY: 50 });
  await flushPromises();
  expect(mocks.store.selectedShelfId).toBe("second");
  expect(menuItems().map((b) => b.textContent?.trim())).toEqual([
    "shelf.unshelve",
    "shelf.exportPatch",
    "shelf.rename",
    "shelf.delete",
  ]);
  mocks.store.shelves.unshift(shelf("new"));
  await flushPromises();
  menuItems()[0]!.click();
  await flushPromises();
  expect(mocks.store.unshelve).toHaveBeenCalledExactlyOnceWith("second", false);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("exports through the toolbar and a context menu with a stable target", async () => {
  const wrapper = create();
  const row = wrapper.findAll('[data-entry="shelf"]')[1]!;
  await row.trigger("click");
  const exportButton = wrapper.findAll("button").find((b) => b.text() === "shelf.exportPatch")!;
  await exportButton.trigger("click");
  expect(mocks.store.promptExportShelf).toHaveBeenLastCalledWith("second");
  await row.trigger("keydown", { key: "F10", shiftKey: true });
  await flushPromises();
  mocks.store.shelves.reverse();
  mocks.store.selectedShelfId = "third";
  await flushPromises();
  menuItems()
    .find((b) => b.textContent?.trim() === "shelf.exportPatch")!
    .click();
  await flushPromises();
  expect(mocks.store.promptExportShelf).toHaveBeenCalledTimes(2);
  expect(mocks.store.promptExportShelf).toHaveBeenLastCalledWith("second");
  expect(mocks.store.unshelve).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(row.element);
});

it("offers only restore for deleted entries and restores focus on Escape", async () => {
  const wrapper = create();
  const row = wrapper.findAll('[data-entry="deleted-shelf"]')[0]!;
  await row.trigger("keydown", { key: "F10", shiftKey: true });
  await flushPromises();
  expect(menuItems().map((b) => b.textContent?.trim())).toEqual(["shelf.restore"]);
  expect(document.activeElement).toBe(menuItems()[0]);
  menuItems()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flushPromises();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(row.element);
  await row.trigger("keydown", { key: "ContextMenu" });
  await flushPromises();
  menuItems()[0]!.click();
  await flushPromises();
  expect(mocks.store.restoreShelf).toHaveBeenCalledExactlyOnceWith("deleted");
});

it("navigates menu actions and restores focus on Tab", async () => {
  const wrapper = create();
  const row = wrapper.findAll('[data-entry="shelf"]')[0]!;
  await row.trigger("contextmenu");
  await flushPromises();
  const press = (key: string) =>
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  press("End");
  expect(document.activeElement).toBe(menuItems()[3]);
  press("ArrowDown");
  expect(document.activeElement).toBe(menuItems()[0]);
  press("ArrowUp");
  expect(document.activeElement).toBe(menuItems()[3]);
  press("Home");
  expect(document.activeElement).toBe(menuItems()[0]);
  press("Tab");
  await flushPromises();
  expect(document.activeElement).toBe(row.element);
});

it("blocks a stale context action when navigation starts", async () => {
  let navigation = 0;
  mocks.workspace.navigationToken = () => navigation;
  const wrapper = create();
  await wrapper.findAll('[data-entry="deleted-shelf"]')[0]!.trigger("contextmenu");
  await flushPromises();
  navigation++;
  menuItems()[0]!.click();
  expect(mocks.store.restoreShelf).not.toHaveBeenCalled();
});

it("closes context menus when their target is removed in place or hidden", async () => {
  const wrapper = create();
  await wrapper.findAll('[data-entry="deleted-shelf"]')[0]!.trigger("contextmenu");
  await flushPromises();
  mocks.store.deletedShelves.splice(0, 1);
  await flushPromises();
  expect(menuItems()).toHaveLength(0);
  await wrapper.findAll('[data-entry="deleted-shelf"]')[0]!.trigger("contextmenu");
  await flushPromises();
  mocks.store.showDeleted = false;
  await flushPromises();
  expect(menuItems()).toHaveLength(0);
  expect(wrapper.find('[data-entry="deleted-shelf"]').exists()).toBe(false);
});

it("guards busy actions and limits F2/Delete to active entries", async () => {
  const wrapper = create();
  const row = wrapper.findAll('[data-entry="shelf"]')[0]!;
  const deleted = wrapper.findAll('[data-entry="deleted-shelf"]')[0]!;
  for (const key of ["F2", "Delete"]) await deleted.trigger("keydown", { key });
  expect(mocks.store.deleteShelf).not.toHaveBeenCalled();
  expect(mocks.store.promptRenameShelf).not.toHaveBeenCalled();
  await row.trigger("click");
  mocks.store.busy = true;
  await flushPromises();
  expect(wrapper.get("fieldset").attributes("disabled")).toBeDefined();
  for (const key of ["F2", "Delete"]) await row.trigger("keydown", { key });
  await row.trigger("contextmenu");
  expect(menuItems()).toHaveLength(0);
  expect(mocks.store.deleteShelf).not.toHaveBeenCalled();
  expect(mocks.store.promptRenameShelf).not.toHaveBeenCalled();
  mocks.store.busy = false;
  for (const key of ["F2", "Delete"]) await row.trigger("keydown", { key, repeat: true });
  expect(mocks.store.deleteShelf).not.toHaveBeenCalled();
  expect(mocks.store.promptRenameShelf).not.toHaveBeenCalled();
  await row.trigger("keydown", { key: "F2" });
  await row.trigger("keydown", { key: "Delete" });
  expect(mocks.store.promptRenameShelf).toHaveBeenCalledExactlyOnceWith("first");
  expect(mocks.store.deleteShelf).toHaveBeenCalledExactlyOnceWith("first");
});

it.each(["ctrlKey", "altKey", "metaKey", "shiftKey", "isComposing"])(
  "does not consume shelf row shortcuts with %s",
  async (modifier) => {
    const wrapper = create();
    for (const section of ["shelf", "deleted-shelf"]) {
      const row = wrapper.findAll(`[data-entry="${section}"]`)[0]!;
      await row.trigger("click");
      const selection = [mocks.store.selectedShelfId, mocks.store.selectedDeletedShelfId];
      for (const key of [
        "Delete",
        "F2",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "ContextMenu",
      ]) {
        const event = new KeyboardEvent("keydown", {
          key,
          [modifier]: true,
          bubbles: true,
          cancelable: true,
        });
        row.element.dispatchEvent(event);
        await flushPromises();
        expect(mocks.store.deleteShelf).not.toHaveBeenCalled();
        expect(mocks.store.promptRenameShelf).not.toHaveBeenCalled();
        expect([mocks.store.selectedShelfId, mocks.store.selectedDeletedShelfId]).toEqual(
          selection,
        );
        expect(row.attributes("aria-expanded")).toBe("false");
        expect(menuItems()).toHaveLength(0);
        expect(event.defaultPrevented).toBe(false);
      }
      if (modifier !== "shiftKey") {
        await row.trigger("keydown", { key: "F10", shiftKey: true, [modifier]: true });
        await flushPromises();
        expect(menuItems()).toHaveLength(0);
      }
    }
  },
);

it("does not repeatedly open the shelf context menu", async () => {
  const wrapper = create();
  const row = wrapper.findAll('[data-entry="shelf"]')[0]!;
  for (const shortcut of [{ key: "ContextMenu" }, { key: "F10", shiftKey: true }]) {
    await row.trigger("keydown", { ...shortcut, repeat: true });
    await flushPromises();
    expect(menuItems()).toHaveLength(0);
  }
});

it("focuses the restored active entry", async () => {
  mocks.store.restoreShelf.mockImplementation(async (id: string) => {
    const entry = mocks.store.deletedShelves.find((s: any) => s.id === id);
    mocks.store.shelves.push(entry);
    mocks.store.deletedShelves = mocks.store.deletedShelves.filter((s: any) => s.id !== id);
    mocks.store.selectedDeletedShelfId = null;
    mocks.store.selectedShelfId = id;
    return true;
  });
  const wrapper = create();
  await wrapper.findAll('[data-entry="deleted-shelf"]')[0]!.trigger("click");
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "shelf.restore")!
    .trigger("click");
  await flushPromises();
  expect(document.activeElement).toBe(
    wrapper.get('[data-entry="shelf"][data-shelf-id="deleted"]').element,
  );
});

it("toggles the deleted list with the store action", async () => {
  const wrapper = create();
  const toggle = wrapper.findAll("button").find((b) => b.text() === "shelf.showDeleted")!;
  expect(toggle.attributes("aria-pressed")).toBe("true");
  await toggle.trigger("click");
  expect(mocks.store.setShowDeleted).toHaveBeenCalledExactlyOnceWith(false);
});

it.each(["shelf", "deleted-shelf"])(
  "expands %s files without applying changes",
  async (section) => {
    const wrapper = create();
    const row = wrapper.findAll(`[data-entry="${section}"]`)[0]!;
    expect(row.attributes("aria-expanded")).toBe("false");
    await row.trigger("keydown", { key: "ArrowRight" });
    expect(row.attributes("aria-expanded")).toBe("true");
    const list = wrapper.get('[role="list"]');
    expect(list.attributes("id")).toBe(row.attributes("aria-controls"));
    expect(list.get('[role="listitem"]').attributes("title")).toBe(
      section === "shelf" ? "first.txt" : "deleted.txt",
    );
    await row.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.findAll('[role="list"]')).toHaveLength(1);
    await list.trigger("keydown", { key: "ArrowLeft" });
    expect(wrapper.find('[role="list"]').exists()).toBe(false);
    expect(document.activeElement).toBe(row.element);
    expect(mocks.store.unshelve).not.toHaveBeenCalled();
    expect(mocks.store.restoreShelf).not.toHaveBeenCalled();
  },
);

it("expands by mouse and keeps paths synchronized after partial application", async () => {
  const wrapper = create();
  const disclosure = wrapper.findAll("[data-shelf-disclosure]")[0]!;
  await disclosure.trigger("click");
  expect(mocks.store.selectedShelfId).toBe("first");
  expect(document.activeElement).toBe(wrapper.get('[data-entry="shelf"]').element);
  mocks.store.shelves[0].paths = ["目录/剩余 文件.txt"];
  await flushPromises();
  expect(wrapper.get('[role="listitem"]').attributes("title")).toBe("目录/剩余 文件.txt");
  await disclosure.trigger("click");
  expect(wrapper.find('[role="list"]').exists()).toBe(false);
});

it("clears expanded state after navigation and removal, including reused IDs", async () => {
  const wrapper = create();
  await wrapper.get('[data-entry="shelf"]').trigger("keydown", { key: "ArrowRight" });
  mocks.workspace.repoPath = "B";
  await flushPromises();
  expect(wrapper.find('[role="list"]').exists()).toBe(false);
  await wrapper.get('[data-entry="shelf"]').trigger("keydown", { key: "ArrowRight" });
  mocks.store.shelves.splice(0, 1);
  await flushPromises();
  mocks.store.shelves.unshift(shelf("first"));
  await flushPromises();
  expect(wrapper.get('[data-entry="shelf"]').attributes("aria-expanded")).toBe("false");
});

it("shows valid saved times and safely omits invalid dates", () => {
  mocks.store.shelves = [
    { ...shelf("dated"), createdAt: 1_704_100_000 },
    { ...shelf("invalid"), createdAt: NaN },
  ];
  const wrapper = create();
  const rows = wrapper.findAll('[data-entry="shelf"]');
  expect(rows[0]!.get("time").attributes("datetime")).toBe(
    new Date(1_704_100_000_000).toISOString(),
  );
  expect(rows[1]!.find("time").exists()).toBe(false);
});

it("bounds thousands of shelves and keeps offscreen navigation, expansion and menu targeting", async () => {
  mocks.store.shelves = Array.from({ length: 5000 }, (_, i) => ({
    ...shelf(`entry-${i}`),
    paths: Array.from({ length: 1000 }, (_, n) => `${i}/file-${n}`),
  }));
  const wrapper = create();
  const port = wrapper.findComponent(VirtualList).get(".overflow-auto").element;
  Object.defineProperty(port, "clientHeight", { configurable: true, value: 440 });
  expect(wrapper.findAll('[data-entry="shelf"]').length).toBeLessThan(25);
  await wrapper.get('[data-entry="shelf"]').trigger("keydown", { key: "End" });
  await flushPromises();
  const last = wrapper.get('[data-shelf-id="entry-4999"]');
  expect(document.activeElement).toBe(last.element);
  await last.trigger("keydown", { key: "ArrowRight" });
  await flushPromises();
  expect(last.attributes("aria-expanded")).toBe("true");
  expect(wrapper.findAll('[role="listitem"]').length).toBeLessThan(30);
  await last.trigger("keydown", { key: "ContextMenu" });
  await flushPromises();
  menuItems()
    .find((item) => item.textContent?.trim() === "shelf.exportPatch")!
    .click();
  await flushPromises();
  expect(mocks.store.promptExportShelf).toHaveBeenCalledWith("entry-4999");
  await last.trigger("keydown", { key: "Home" });
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.get('[data-shelf-id="entry-0"]').element);
  expect(wrapper.find('[data-shelf-id="entry-4999"]').exists()).toBe(false);
  await wrapper.get('[data-shelf-id="entry-0"]').trigger("keydown", { key: "End" });
  await flushPromises();
  expect(wrapper.get('[data-shelf-id="entry-4999"]').attributes("aria-expanded")).toBe("true");
});
