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
enableAutoUnmount(afterEach);
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

it("skips unavailable actions without a repository and activates the focused action", async () => {
  mount(VcsOperationsPopup, { attachTo: document.body });
  await flushPromises();
  const actions = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  expect(actions.slice(0, 2).map((item) => item.textContent?.trim())).toEqual(["Update", "Open"]);
  expect(actions[2]?.textContent).toContain("toolbar.recentProjects");
  expect(actions[0]!.disabled).toBe(true);
  expect(document.activeElement).toBe(actions[1]);
  actions[1]!.dispatchEvent(
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
  expect(document.activeElement?.textContent?.trim()).toBe("Update");
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
  expect(current.disabled).toBe(true);
  expect(current.getAttribute("aria-current")).toBe("page");
  document.querySelector<HTMLButtonElement>('[aria-label="other/project"]')!.click();
  await flushPromises();
  expect(mocks.recent).toHaveBeenCalledExactlyOnceWith("other/project");
  expect(mocks.layout.vcsPopupOpen).toBe(false);
  mocks.layout.vcsPopupOpen = true;
  await flushPromises();
  expect(document.querySelector('[aria-label="other/project"]')).toBeNull();
});
