import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import ShelfList from "./ShelfList.vue";

const mocks = vi.hoisted(() => ({ store: {} as any, workspace: {} as any }));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => mocks.store }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const shelf = (id: string) => ({ id, message: id, paths: [`${id}.txt`] });
enableAutoUnmount(afterEach);
beforeEach(() => {
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
    deleteShelf: vi.fn(),
  });
});
afterEach(() => {
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
  expect(document.activeElement).toBe(menuItems()[2]);
  press("ArrowDown");
  expect(document.activeElement).toBe(menuItems()[0]);
  press("ArrowUp");
  expect(document.activeElement).toBe(menuItems()[2]);
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
