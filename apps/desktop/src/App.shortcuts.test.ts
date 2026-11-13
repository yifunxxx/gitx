import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { reactive } from "vue";
import App from "./App.vue";
import type { ActionDef } from "@/actions/types";
const state = vi.hoisted(() => ({
  layout: {} as any,
  settings: {} as any,
  workspace: {} as any,
  run: vi.fn(),
  actions: [] as ActionDef[],
}));
vi.mock("@/actions/registry", () => ({ listActions: () => state.actions }));
vi.mock("@/actions", async () => ({ ...(await import("@/actions/keymap")), runAction: state.run }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => state.layout }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => state.settings }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => state.workspace }));
vi.mock("@/stores/consoleStore", () => ({ useConsoleStore: () => ({ append: vi.fn() }) }));
vi.mock("@/stores/updateStore", () => ({
  useUpdateStore: () => ({ startAutoChecks: vi.fn(), stopAutoChecks: vi.fn() }),
}));
vi.mock("@/composables/useRepositoryRefresh", () => ({ useRepositoryRefresh: () => {} }));
vi.mock("@/composables/useAppEvents", () => ({ useAppEvents: () => {} }));
let wrapper: ReturnType<typeof shallowMount>;
let input: HTMLInputElement;
const key = (init: KeyboardEventInit, target: EventTarget = input) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};
beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  const modifierState = KeyboardEvent.prototype.getModifierState;
  vi.spyOn(KeyboardEvent.prototype, "getModifierState").mockImplementation(function (this: KeyboardEvent, name) {
    return name === "AltGraph" ? false : modifierState.call(this, name);
  });
  state.actions = [
    {
      id: "Settings",
      title: "Settings",
      defaultShortcuts: { win: ["mod+,"] },
      run: async () => {},
    },
    {
      id: "File.Save",
      title: "Save",
      defaultShortcuts: { win: ["mod+s"] },
      run: async () => {},
    },
    {
      id: "Git.Push",
      title: "Push",
      defaultShortcuts: { win: ["mod+shift+k"] },
      run: async () => {},
    },
  ];
  state.settings = reactive({
    settings: { keymapOverrides: { Settings: ["mod+alt+9"] } },
    load: vi.fn(),
  });
  state.workspace = reactive({
    toplevel: null,
    folderPath: null,
    loadRecent: vi.fn(),
    detectGit: vi.fn(),
  });
  state.layout = reactive({ bottomOpen: false, activeBottomTab: "log", findActionOpen: false });
  wrapper = shallowMount(App, { attachTo: document.body });
  await flushPromises();
  input = document.createElement("input");
  document.body.append(input);
});
afterEach(() => {
  wrapper.unmount();
  input.remove();
  vi.restoreAllMocks();
});

it("honors a rebound Settings shortcut from input without keeping the old binding", () => {
  key({ key: ",", ctrlKey: true });
  expect(state.run).not.toHaveBeenCalled();
  key({ key: "9", ctrlKey: true, altKey: true });
  expect(state.run).toHaveBeenCalledOnce();
  expect(state.run.mock.calls[0]![0]).toBe("Settings");
});

it("leaves other action shortcuts to editors and dialogs", () => {
  key({ key: "K", ctrlKey: true, shiftKey: true });
  expect(state.run).not.toHaveBeenCalled();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  key({ key: "K", ctrlKey: true, shiftKey: true }, dialog);
  expect(state.run).not.toHaveBeenCalled();
  dialog.remove();
  key({ key: "K", ctrlKey: true, shiftKey: true }, document.body);
  expect(state.run).toHaveBeenCalledOnce();
});

it("still runs File.Save from a contentEditable editor host", () => {
  const host = document.createElement("div");
  host.contentEditable = "true";
  document.body.append(host);
  key({ key: "s", ctrlKey: true }, host);
  expect(state.run).toHaveBeenCalledExactlyOnceWith(
    "File.Save",
    expect.objectContaining({ source: "shortcut" }),
  );
  host.remove();
});

it.each([{ repeat: true }, { isComposing: true }, { keyCode: 229 }])(
  "ignores repeated/composing global input %j",
  (flags) => {
    key({ key: "9", ctrlKey: true, altKey: true, ...flags });
    key({ key: "A", ctrlKey: true, shiftKey: true, ...flags });
    expect(state.run).not.toHaveBeenCalled();
    expect(state.layout.findActionOpen).toBe(false);
  },
);

it("does not steal consumed keys or extra-modifier variants of Find Action", () => {
  const event = new KeyboardEvent("keydown", {
    key: "A",
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  event.preventDefault();
  input.dispatchEvent(event);
  key({ key: "A", ctrlKey: true, shiftKey: true, altKey: true });
  expect(state.layout.findActionOpen).toBe(false);
  key({ key: "A", ctrlKey: true, shiftKey: true });
  expect(state.layout.findActionOpen).toBe(true);
});

it("removes the global listener when the app unmounts", () => {
  wrapper.unmount();
  key({ key: "9", ctrlKey: true, altKey: true });
  expect(state.run).not.toHaveBeenCalled();
});

it("preserves terminal toggle handling with native key/code omissions", () => {
  key({ key: "`", ctrlKey: true });
  expect(state.layout.activeBottomTab).toBe("terminal");
  expect(state.layout.bottomOpen).toBe(true);
  key({ code: "Backquote", ctrlKey: true });
  expect(state.layout.bottomOpen).toBe(false);
});
