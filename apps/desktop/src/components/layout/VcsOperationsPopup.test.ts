import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive, ref } from "vue";
import VcsOperationsPopup from "./VcsOperationsPopup.vue";

const mocks = vi.hoisted(() => ({
  layout: {} as any,
  workspace: {} as any,
  run: vi.fn(),
  recent: vi.fn(),
  folder: vi.fn(),
}));
vi.mock("@/composables/useWorkspaceOpen", () => ({
  useWorkspaceOpen: () => ({
    pending: ref(false),
    openRecent: mocks.recent,
    openFolder: mocks.folder,
  }),
}));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/actions/titles", () => ({ resolveActionTitle: (action: { id: string }) => action.id }));
vi.mock("@/actions", () => ({
  getGroup: () => ({ children: ["Update", "-", "Open", "Hidden"] }),
  getAction: (id: string) => ({ id }),
  isVisible: (action: { id: string }) => action.id !== "Hidden",
  isEnabled: (action: { id: string }, context: { repoIds: string[] }) =>
    action.id !== "Update" || context.repoIds.length > 0,
  shortcutFor: () => [],
  runAction: mocks.run,
}));
beforeEach(() => {
  mocks.layout = reactive({ vcsPopupOpen: true });
  mocks.workspace = reactive({
    toplevel: null,
    folderPath: "fixture",
    recent: ["fixture", "other/project"],
  });
  mocks.run.mockReset();
  mocks.recent.mockReset();
});
afterEach(() => {
  document.body.innerHTML = "";
});
enableAutoUnmount(afterEach);

it("skips unavailable actions without a repository and activates the focused action", async () => {
  mount(VcsOperationsPopup, { attachTo: document.body });
  await flushPromises();
  const actions = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  expect(actions[0]?.textContent).toContain("toolbar.recentProjects");
  expect(actions.slice(1).map((item) => item.textContent?.trim())).toEqual(["Update", "Open"]);
  expect(actions[1]!.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(actions[0]);
  actions[0]!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
  );
  await flushPromises();
  expect(document.activeElement).toBe(actions[2]);
  actions[2]!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  await flushPromises();
  expect(mocks.layout.vcsPopupOpen).toBe(false);
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(
    "Open",
    expect.objectContaining({ repoIds: [], folderPath: "fixture" }),
  );
});

it("enables repository actions and closes on Escape without running a command", async () => {
  mocks.workspace.toplevel = "fixture";
  mount(VcsOperationsPopup, { attachTo: document.body });
  await flushPromises();
  expect(document.activeElement?.textContent).toContain("toolbar.recentProjects");
  document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await flushPromises();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(mocks.run).not.toHaveBeenCalled();
});

it("opens a recent project through the main menu and resets the submenu next time", async () => {
  mount(VcsOperationsPopup, { attachTo: document.body });
  await flushPromises();
  const recent = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (b) => b.textContent?.includes("toolbar.recentProjects"),
  )!;
  recent.click();
  await flushPromises();
  const current = document.querySelector<HTMLButtonElement>('[aria-label="fixture"]')!;
  expect(current.getAttribute("aria-disabled")).toBe("true");
  expect(current.getAttribute("aria-current")).toBe("page");
  document.querySelector<HTMLButtonElement>('[aria-label="other/project"]')!.click();
  await flushPromises();
  expect(mocks.recent).toHaveBeenCalledExactlyOnceWith("other/project");
  expect(mocks.layout.vcsPopupOpen).toBe(false);
  mocks.layout.vcsPopupOpen = true;
  await flushPromises();
  expect(document.querySelector('[aria-label="other/project"]')).toBeNull();
});

function key(key: string, options: KeyboardEventInit = {}) {
  document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
  );
}

it("keeps the parent menu visible, enters with Right and returns with Left", async () => {
  mount(VcsOperationsPopup, { attachTo: document.body });
  await flushPromises();
  const trigger = document.activeElement;
  key("ArrowRight");
  await flushPromises();
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2);
  expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement?.textContent).toBe("welcome.open");
  key("ArrowDown");
  await flushPromises();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("other/project");
  key("ArrowLeft");
  await flushPromises();
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  expect(document.activeElement).toBe(trigger);
  expect(mocks.layout.vcsPopupOpen).toBe(true);
});

it("closes only the submenu on Escape and restores the original opener on the next Escape", async () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  mount(VcsOperationsPopup, { attachTo: document.body });
  await flushPromises();
  const trigger = document.activeElement;
  key("ArrowRight");
  await flushPromises();
  key("Escape");
  await flushPromises();
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  expect(document.activeElement).toBe(trigger);
  key("Escape");
  await flushPromises();
  expect(mocks.layout.vcsPopupOpen).toBe(false);
  expect(document.activeElement).toBe(opener);
});

it("opens the submenu on hover and leaves the parent actions available", async () => {
  mount(VcsOperationsPopup, { attachTo: document.body });
  await flushPromises();
  const trigger = document.activeElement!;
  trigger.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 140));
  await flushPromises();
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(2);
  const open = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
    (item) => item.textContent === "Open",
  )!;
  open.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", bubbles: true }));
  await flushPromises();
  expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  expect(document.activeElement).toBe(open);
});

it.each(["Tab", "Escape"])(
  "dismisses the main menu with %s and isolates keyboard shortcuts",
  async (shortcut) => {
    const globalKey = vi.fn();
    window.addEventListener("keydown", globalKey);
    try {
      mount(VcsOperationsPopup, { attachTo: document.body });
      await flushPromises();
      for (const options of [{ ctrlKey: true }, { isComposing: true }, { repeat: true }]) {
        key("ArrowRight", options);
        key("Enter", options);
      }
      key("Delete");
      await flushPromises();
      expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
      expect(mocks.run).not.toHaveBeenCalled();
      expect(globalKey).not.toHaveBeenCalled();
      key(shortcut);
      await flushPromises();
      expect(mocks.layout.vcsPopupOpen).toBe(false);
    } finally {
      window.removeEventListener("keydown", globalKey);
    }
  },
);

it("restores the opener before launching a recent project and keeps the new input focused", async () => {
  const opener = document.createElement("button");
  const input = document.createElement("input");
  document.body.append(opener, input);
  opener.focus();
  mocks.recent.mockImplementation(() => {
    expect(document.activeElement).toBe(opener);
    input.focus();
  });
  mount(VcsOperationsPopup, { attachTo: document.body });
  await flushPromises();
  key("ArrowRight");
  await flushPromises();
  document.querySelector<HTMLButtonElement>('[aria-label="other/project"]')!.click();
  await flushPromises();
  expect(document.activeElement).toBe(input);
});
