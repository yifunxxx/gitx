import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import FindActionPalette from "./FindActionPalette.vue";

const mocks = vi.hoisted(() => ({
  layout: {} as any,
  workspace: {} as any,
  run: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/actions", () => ({
  searchActions: () => [
    { id: "disabled", title: "Disabled", enabled: () => false },
    { id: "first", title: "First" },
    { id: "last", title: "Last" },
  ],
  isEnabled: (a: any) => a.enabled?.() ?? true,
  runAction: mocks.run,
  shortcutFor: () => [],
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

let wrapper: ReturnType<typeof mount>;
let opener: HTMLButtonElement;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.layout = reactive({ findActionOpen: false });
  mocks.workspace = reactive({ toplevel: "A", repoPath: "A", folderPath: "A" });
  opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  wrapper = mount(FindActionPalette, { attachTo: document.body });
});
afterEach(() => {
  wrapper.unmount();
  document.body.innerHTML = "";
});
async function open() {
  mocks.layout.findActionOpen = true;
  await flushPromises();
}
async function key(key: string, extra: Record<string, unknown> = {}) {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }),
  );
  await nextTick();
}

it("focuses search, skips disabled actions with arrows, and runs the chosen action with Enter", async () => {
  await open();
  expect(document.activeElement).toBe(wrapper.get("input").element);
  expect(wrapper.findAll("button")[0]!.attributes("disabled")).toBeDefined();
  await key("ArrowDown");
  expect(document.activeElement?.textContent).toContain("First");
  await key("ArrowDown");
  expect(document.activeElement?.textContent).toContain("Last");
  await key("Enter");
  expect(mocks.run).toHaveBeenCalledWith("last", expect.any(Object));
  expect(mocks.layout.findActionOpen).toBe(false);
});

it("traps Tab and restores the opener on Escape", async () => {
  await open();
  await key("Tab", { shiftKey: true });
  expect(document.activeElement?.textContent).toContain("Last");
  await key("Tab");
  expect(document.activeElement).toBe(wrapper.get("input").element);
  await key("Escape");
  expect(document.activeElement).toBe(opener);
});

it("does not execute Enter used to confirm IME composition", async () => {
  await open();
  await key("Enter", { isComposing: true });
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.layout.findActionOpen).toBe(true);
  await key("Enter");
  expect(mocks.run).toHaveBeenCalledWith("first", expect.any(Object));
});

it("restores focus before an action opens another dialog and reports rejected actions", async () => {
  const destination = document.createElement("input");
  document.body.append(destination);
  mocks.run.mockImplementation(async () => {
    destination.focus();
    throw new Error("operation failed");
  });
  await open();
  await key("Enter");
  await flushPromises();
  expect(document.activeElement).toBe(destination);
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "operation failed" }));
});

it("closes on repository navigation and cancels delayed focus after unmount", async () => {
  await open();
  mocks.workspace.repoPath = "B";
  await nextTick();
  expect(mocks.layout.findActionOpen).toBe(false);
  expect(document.activeElement).toBe(opener);
  mocks.layout.findActionOpen = true;
  wrapper.unmount();
  await flushPromises();
  expect(document.activeElement).toBe(opener);
});
