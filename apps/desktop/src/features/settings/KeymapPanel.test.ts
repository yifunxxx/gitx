import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import KeymapPanel from "./KeymapPanel.vue";
import { useSettingsStore } from "@/stores/settingsStore";
import { i18n } from "@/i18n";
import { setKeymapOverridesProvider } from "@/actions/keymap";
import type { ActionDef } from "@/actions/types";
const state = vi.hoisted(() => ({ actions: [] as ActionDef[] }));
vi.mock("@/actions/registry", () => ({ listActions: () => state.actions }));
vi.mock("@/actions", async () => ({
  ...(await import("@/actions/keymap")),
  listActions: () => state.actions,
}));
let wrapper: ReturnType<typeof mount<typeof KeymapPanel>>;
let store: ReturnType<typeof useSettingsStore>;
const row = (id: string) => wrapper.findAll("tbody tr").find((item) => item.text().includes(id))!;
const button = (id: string, label: string) =>
  row(id)
    .findAll("button")
    .find((item) => item.text() === label)!;
async function record(id: string, init: KeyboardEventInit) {
  await button(id, "重新绑定").trigger("click");
  const input = row(id).find("input");
  await (input.exists() ? input : button(id, "重新绑定")).trigger("keydown", init);
}
beforeEach(() => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  const modifierState = KeyboardEvent.prototype.getModifierState;
  vi.spyOn(KeyboardEvent.prototype, "getModifierState").mockImplementation(function (this: KeyboardEvent, key) {
    return key === "AltGraph" ? false : modifierState.call(this, key);
  });
  setActivePinia(createPinia());
  store = useSettingsStore();
  i18n.global.locale.value = "zh-CN";
  state.actions = [
    {
      id: "Settings",
      title: "Settings…",
      defaultShortcuts: { win: ["mod+,"] },
      run: async () => {},
    },
    {
      id: "Git.Push",
      title: "Push…",
      defaultShortcuts: { win: ["ctrl+shift+k"] },
      run: async () => {},
    },
  ];
  setKeymapOverridesProvider(() => ({ Settings: ["mod+9"] }));
  const draft = store.emptySettings();
  draft.keymapOverrides = { Settings: ["mod+9"] };
  wrapper = mount(KeymapPanel, {
    attachTo: document.body,
    props: {
      draft,
      onPatch(overrides) {
        void wrapper.setProps({ draft: { ...draft, keymapOverrides: overrides } });
      },
    },
    global: { plugins: [i18n] },
  });
});
afterEach(() => {
  wrapper.unmount();
  store.$dispose();
  vi.restoreAllMocks();
});

it("renders a reset from the draft defaults without falling back to persisted overrides", async () => {
  await button("Settings", "重置").trigger("click");
  await nextTick();
  expect(row("Settings").get("kbd").text()).toBe("Ctrl+,");
});
it("localizes action titles and searches localized names", async () => {
  await wrapper.get('input[type="search"]').setValue("设置");
  expect(wrapper.findAll("tbody tr")).toHaveLength(1);
  expect(wrapper.text()).toContain("Settings");
});
it("rejects a conflicting shortcut instead of silently creating ambiguous dispatch", async () => {
  await record("Settings", { key: "K", code: "KeyK", ctrlKey: true, shiftKey: true });
  expect(wrapper.emitted("patch")).toBeUndefined();
  expect(wrapper.find('[role="alert"]').exists()).toBe(true);
});
it("ignores IME and held keys while recording", async () => {
  await record("Settings", { key: "Process", isComposing: true });
  expect(wrapper.emitted("patch")).toBeUndefined();
});

it("records once, restores focus and leaves the persisted keymap unchanged", async () => {
  await record("Settings", { key: "9", ctrlKey: true, altKey: true });
  await nextTick();
  expect(wrapper.emitted("patch")).toHaveLength(1);
  expect(row("Settings").get("kbd").text()).toBe("Ctrl+Alt+9");
  expect(document.activeElement).toBe(button("Settings", "重新绑定").element);
});

it("allows removing a conflicting binding before reassigning it", async () => {
  await button("Git.Push", "移除绑定").trigger("click");
  expect(row("Git.Push").text()).toContain("未绑定");
  await record("Settings", { key: "K", ctrlKey: true, shiftKey: true });
  expect(row("Settings").get("kbd").text()).toBe("Ctrl+Shift+K");
  expect(wrapper.props("draft").keymapOverrides).toEqual({
    Settings: ["mod+shift+k"],
    "Git.Push": [],
  });
  await button("Git.Push", "重置").trigger("click");
  expect(wrapper.get('[role="alert"]').text()).toContain("Ctrl+Shift+K");
  expect(row("Git.Push").text()).toContain("未绑定");
});

it("restores all defaults immediately and leaves unknown saved action IDs behind only until reset", async () => {
  await wrapper.setProps({
    draft: {
      ...wrapper.props("draft"),
      keymapOverrides: { Settings: ["mod+9"], unknown: ["mod+8"] },
    },
  });
  await wrapper
    .findAll("button")
    .find((item) => item.text() === "全部重置")!
    .trigger("click");
  expect(wrapper.props("draft").keymapOverrides).toEqual({});
  expect(row("Settings").get("kbd").text()).toBe("Ctrl+,");
});

it("cancels recording on Escape without bubbling to the settings dialog", async () => {
  const listener = vi.fn();
  wrapper.element.addEventListener("keydown", listener);
  await record("Settings", { key: "Escape" });
  expect(listener).not.toHaveBeenCalled();
  expect(wrapper.find("[data-keymap-recorder]").exists()).toBe(false);
  expect(wrapper.emitted("patch")).toBeUndefined();
});

it("ends recording on Tab, blur, filter changes, and disabling", async () => {
  await record("Settings", { key: "Tab" });
  expect(wrapper.find("[data-keymap-recorder]").exists()).toBe(false);
  await button("Settings", "重新绑定").trigger("click");
  await wrapper.get("[data-keymap-recorder]").trigger("blur");
  expect(wrapper.find("[data-keymap-recorder]").exists()).toBe(false);
  await button("Settings", "重新绑定").trigger("click");
  await wrapper.get('input[type="search"]').setValue("ctrl");
  expect(wrapper.find("[data-keymap-recorder]").exists()).toBe(false);
  await button("Settings", "重新绑定").trigger("click");
  await wrapper.setProps({ disabled: true });
  expect(wrapper.find("[data-keymap-recorder]").exists()).toBe(false);
  expect(wrapper.emitted("patch")).toBeUndefined();
});

it("rejects fixed app shortcuts without dispatching them and lets the user retry", async () => {
  await record("Settings", { key: "A", code: "KeyA", ctrlKey: true, shiftKey: true });
  expect(wrapper.get('[role="alert"]').text()).toContain("Ctrl+Shift+A");
  expect(wrapper.find("[data-keymap-recorder]").exists()).toBe(true);
  await wrapper
    .get("[data-keymap-recorder]")
    .trigger("keydown", { key: "9", ctrlKey: true, altKey: true });
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.emitted("patch")).toHaveLength(1);
});

it("ignores repeat and composition Escape without ending the recording", async () => {
  await record("Settings", { key: "9", ctrlKey: true, repeat: true });
  await wrapper
    .get("[data-keymap-recorder]")
    .trigger("keydown", { key: "Escape", isComposing: true });
  expect(wrapper.find("[data-keymap-recorder]").exists()).toBe(true);
  expect(wrapper.emitted("patch")).toBeUndefined();
});

it("shows legacy duplicate warnings and an explicit empty search result", async () => {
  await wrapper.setProps({
    draft: { ...wrapper.props("draft"), keymapOverrides: { Settings: ["mod+shift+k"] } },
  });
  expect(row("Settings").text()).toContain("已用于");
  await wrapper.get('input[type="search"]').setValue("no-such-action");
  expect(wrapper.text()).toContain("没有匹配的设置项");
});
