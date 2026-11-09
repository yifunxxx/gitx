import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import StashShelfView from "./StashShelfView.vue";

const mocks = vi.hoisted(() => ({ store: {} as any, workspace: {} as any }));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => mocks.store }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useConfirm", () => ({ promptDialog: vi.fn() }));
enableAutoUnmount(afterEach);
beforeEach(() => {
  mocks.workspace = reactive({ isRepo: true, repoPath: "A", navigationToken: () => 0 });
  mocks.store = reactive({
    stashes: [
      { sha: "first", index: 0, message: "first stash" },
      { sha: "second", index: 1, message: "second stash" },
      { sha: "third", index: 2, message: "third stash" },
    ],
    shelves: [],
    selectedStashSha: null,
    selectedShelfId: null,
    busy: false,
    loading: false,
    error: null,
    repositoryToken: () => 0,
    get selectedStash() {
      return this.stashes.find((entry) => entry.sha === this.selectedStashSha);
    },
    stashRefOf: (s: { index: number }) => `stash@{${s.index}}`,
    refresh: vi.fn(),
    applyStash: vi.fn(),
    popStash: vi.fn(),
    dropStash: vi.fn(),
    clearStashes: vi.fn(),
    promptStash: vi.fn(),
    promptRenameShelf: vi.fn(),
    promptImportShelf: vi.fn(),
  });
});
afterEach(() => {
  document.body.innerHTML = "";
});
const create = () => mount(StashShelfView, { props: { mode: "stash" }, attachTo: document.body });

it("selects with clicks and keyboard without applying on double click", async () => {
  const wrapper = create();
  const rows = wrapper.findAll('[data-entry="stash"]');
  await rows[0]!.trigger("click");
  await rows[0]!.trigger("dblclick");
  expect(mocks.store.selectedStashSha).toBe("first");
  expect(mocks.store.applyStash).not.toHaveBeenCalled();
  await rows[0]!.trigger("keydown", { key: "End" });
  expect(mocks.store.selectedStashSha).toBe("third");
  expect(document.activeElement).toBe(rows[2]!.element);
  await rows[2]!.trigger("keydown", { key: "ArrowUp" });
  expect(mocks.store.selectedStashSha).toBe("second");
  await rows[1]!.trigger("keydown", { key: "Home" });
  expect(mocks.store.selectedStashSha).toBe("first");
  await rows[0]!.trigger("keydown", { key: "ArrowDown" });
  expect(mocks.store.selectedStashSha).toBe("second");
});

it("right click selects its target and keeps that SHA if the list is renumbered", async () => {
  const wrapper = create();
  await wrapper
    .findAll('[data-entry="stash"]')[1]!
    .trigger("contextmenu", { clientX: 100, clientY: 100 });
  await flushPromises();
  expect(mocks.store.selectedStashSha).toBe("second");
  const firstAction = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  expect(document.activeElement).toBe(firstAction);
  mocks.store.stashes.unshift({ sha: "new", index: 0, message: "new" });
  mocks.store.stashes.forEach((s: any, i: number) => {
    s.index = i;
  });
  await flushPromises();
  firstAction.click();
  await flushPromises();
  expect(mocks.store.applyStash).toHaveBeenCalledExactlyOnceWith("second", false);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("opens the menu with Shift+F10 and restores focus on Escape", async () => {
  const wrapper = create();
  const row = wrapper.findAll('[data-entry="stash"]')[1]!;
  await row.trigger("keydown", { key: "F10", shiftKey: true });
  await flushPromises();
  const buttons = document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  buttons[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(document.activeElement).toBe(buttons[1]);
  buttons[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flushPromises();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(row.element);
});

it("passes the explicit index option and guards busy destructive actions", async () => {
  const wrapper = create();
  const row = wrapper.findAll('[data-entry="stash"]')[0]!;
  await row.trigger("click");
  await wrapper.get('input[type="checkbox"]').setValue(true);
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "stash.pop")!
    .trigger("click");
  expect(mocks.store.popStash).toHaveBeenCalledExactlyOnceWith("first", true);
  mocks.store.busy = true;
  await flushPromises();
  expect(wrapper.get("fieldset").attributes("disabled")).toBeDefined();
  await row.trigger("keydown", { key: "Delete" });
  expect(mocks.store.dropStash).not.toHaveBeenCalled();
  await row.trigger("contextmenu");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  mocks.store.busy = false;
  await row.trigger("keydown", { key: "Delete" });
  expect(mocks.store.dropStash).toHaveBeenCalledExactlyOnceWith("first");
});

it("discards menu actions after navigation starts or their target disappears", async () => {
  let navigation = 0;
  mocks.workspace.navigationToken = () => navigation;
  const wrapper = create();
  const row = wrapper.findAll('[data-entry="stash"]')[0]!;
  await row.trigger("contextmenu");
  await flushPromises();
  navigation++;
  document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
  expect(mocks.store.applyStash).not.toHaveBeenCalled();
  await row.trigger("contextmenu");
  await flushPromises();
  mocks.store.stashes = mocks.store.stashes.slice(1);
  await flushPromises();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("keeps applied shelves by default and makes removal an explicit option", async () => {
  mocks.store.shelves = [{ id: "saved", message: "saved shelf", paths: ["a.txt"] }];
  mocks.store.selectedShelfId = "saved";
  mocks.store.unshelve = vi.fn();
  const wrapper = mount(StashShelfView, { props: { mode: "shelf" } });
  const apply = wrapper.findAll("button").find((b) => b.text() === "shelf.unshelve")!;
  await apply.trigger("click");
  expect(mocks.store.unshelve).toHaveBeenLastCalledWith("saved", false);
  await wrapper.get('input[type="checkbox"]').setValue(true);
  await apply.trigger("click");
  expect(mocks.store.unshelve).toHaveBeenLastCalledWith("saved", true);
  mocks.store.busy = true;
  await flushPromises();
  expect(wrapper.get("fieldset").attributes("disabled")).toBeDefined();
});

it("passes the selected Shelf identity to the guarded rename dialog", async () => {
  mocks.store.shelves = [{ id: "saved", message: "saved shelf", paths: ["a.txt"] }];
  mocks.store.selectedShelfId = "saved";
  const wrapper = mount(StashShelfView, { props: { mode: "shelf" } });
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "shelf.rename")!
    .trigger("click");
  expect(mocks.store.promptRenameShelf).toHaveBeenCalledExactlyOnceWith("saved");
});

it("exposes import in Shelf views and disables it while busy or outside a repository", async () => {
  const wrapper = mount(StashShelfView, { props: { mode: "shelf" } });
  const button = () => wrapper.findAll("button").find((b) => b.text() === "shelf.importPatch");
  await button()!.trigger("click");
  expect(mocks.store.promptImportShelf).toHaveBeenCalledOnce();
  mocks.store.busy = true;
  await flushPromises();
  expect(button()!.attributes("disabled")).toBeDefined();
  mocks.store.busy = false;
  mocks.workspace.isRepo = false;
  await flushPromises();
  expect(button()!.attributes("disabled")).toBeDefined();
  await wrapper.setProps({ mode: "stash" });
  expect(button()).toBeUndefined();
  await wrapper.setProps({ mode: "combined" });
  expect(button()).toBeDefined();
});
