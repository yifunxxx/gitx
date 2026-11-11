import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { defineComponent, nextTick } from "vue";
import SettingsDialog from "./SettingsDialog.vue";
import DialogHost from "@/components/common/DialogHost.vue";
import { Select } from "@/components/ui/select";
import { closeDialog, openDialog, useDialogState } from "@/composables/useDialog";
import { useSettingsStore } from "@/stores/settingsStore";
import { i18n } from "@/i18n";
import type { AppSettings } from "@/lib/backend";

const backend = vi.hoisted(() => ({
  settingsGet: vi.fn(), settingsSet: vi.fn(), gitDetect: vi.fn(), gitTestExecutable: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => backend }));
vi.mock("@/actions", () => ({ listActions: () => [], detectPlatform: () => "win", shortcutFor: () => [] }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let pinia: Pinia;
let store: ReturnType<typeof useSettingsStore>;
let host: ReturnType<typeof mount>;
const button = (text: string) => host.findAll("button").find((b) => b.text() === text)!;
async function open() {
  void openDialog(SettingsDialog);
  await flushPromises();
}
async function theme(value: string) {
  host.findComponent(SettingsDialog).findAllComponents(Select)[0]!.vm.$emit("update:modelValue", value);
  await nextTick();
}
beforeEach(async () => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  store = useSettingsStore();
  const initial = store.emptySettings();
  initial.appearance.theme = "dark";
  backend.settingsGet.mockResolvedValue(initial);
  backend.settingsSet.mockImplementation(async (value: AppSettings) => value);
  await store.load();
  host = mount(DialogHost, { attachTo: document.body, global: { plugins: [pinia, i18n] } });
  await open();
});
afterEach(() => { host.unmount(); store.$dispose(); });

it("restores unsaved appearance when the host closes the dialog", async () => {
  await theme("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  closeDialog();
  await nextTick();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(backend.settingsSet).not.toHaveBeenCalled();
});

it("does not close a newer dialog after a delayed OK completes", async () => {
  const pending = deferred<AppSettings>();
  backend.settingsSet.mockReturnValue(pending.promise);
  await theme("light");
  await button("OK").trigger("click");
  const saved = backend.settingsSet.mock.calls[0]![0];
  closeDialog();
  await nextTick();
  void openDialog(defineComponent({ template: '<div role="dialog">New dialog</div>' }));
  await nextTick();
  const nextId = useDialogState().value!.id;
  pending.resolve(saved);
  await flushPromises();
  expect(useDialogState().value?.id).toBe(nextId);
});

it("submits only one save while Apply is pending", async () => {
  const pending = deferred<AppSettings>();
  backend.settingsSet.mockReturnValue(pending.promise);
  await theme("light");
  await button("Apply").trigger("click");
  await button("Apply").trigger("click");
  await button("OK").trigger("click");
  expect(backend.settingsSet).toHaveBeenCalledTimes(1);
  pending.resolve(backend.settingsSet.mock.calls[0]![0]);
  await flushPromises();
  expect(backend.settingsSet).toHaveBeenCalledTimes(1);
});

it("shows all appearance fields for a matching page title", async () => {
  await host.get('input[type="search"]').setValue("Appearance");
  expect(host.findComponent(SettingsDialog).findAllComponents(Select)).toHaveLength(4);
});

it("rejects out-of-range fetch intervals before persistence", async () => {
  await host.findAll("nav button")[1]!.trigger("click");
  await host.get('input[type="number"]').setValue(-1);
  await button("Apply").trigger("click");
  expect(backend.settingsSet).not.toHaveBeenCalled();
});

it("tests automatic Git detection independently of the saved path", async () => {
  await host.findAll("nav button")[1]!.trigger("click");
  backend.gitTestExecutable.mockResolvedValue({ path: "C:/Git/git.exe", version: "2.50" });
  backend.gitDetect.mockResolvedValue({ path: "old", version: "2.49" });
  await button("Test").trigger("click");
  await flushPromises();
  expect(backend.gitTestExecutable).toHaveBeenCalledExactlyOnceWith("");
  expect(backend.gitDetect).not.toHaveBeenCalled();
});

it("keeps failed saves editable and retries the same draft", async () => {
  backend.settingsSet.mockRejectedValueOnce({ message: "Disk is read-only" });
  await theme("light");
  await button("OK").trigger("click");
  await flushPromises();
  expect(host.get('[role="alert"]').text()).toContain("Disk is read-only");
  expect(host.findComponent(SettingsDialog).exists()).toBe(true);
  expect(store.settings!.appearance.theme).toBe("dark");
  await button("OK").trigger("click");
  await flushPromises();
  expect(backend.settingsSet).toHaveBeenCalledTimes(2);
  expect(store.settings!.appearance.theme).toBe("light");
  expect(host.findComponent(SettingsDialog).exists()).toBe(false);
});

it("locks editing and Escape during save, and cancels to the last applied theme", async () => {
  const pending = deferred<AppSettings>();
  backend.settingsSet.mockReturnValueOnce(pending.promise);
  await theme("light");
  await button("Apply").trigger("click");
  expect(host.get('fieldset').attributes("disabled")).toBeDefined();
  await theme("dark"); // even a late model event cannot edit a submitted draft
  await host.get('input[type="search"]').trigger("keydown", { key: "Escape" });
  expect(host.findComponent(SettingsDialog).exists()).toBe(true);
  pending.resolve(backend.settingsSet.mock.calls[0]![0]);
  await flushPromises();
  expect(button("Apply").attributes("disabled")).toBeDefined();
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  await theme("dark");
  await button("Cancel").trigger("click");
  await flushPromises();
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

it("preserves a newer settings preview while an older save completes", async () => {
  const pending = deferred<AppSettings>();
  backend.settingsSet.mockReturnValue(pending.promise);
  await theme("light");
  await button("OK").trigger("click");
  closeDialog();
  await nextTick();
  await open();
  await theme("dark");
  pending.resolve(backend.settingsSet.mock.calls[0]![0]);
  await flushPromises();
  expect(host.findComponent(SettingsDialog).exists()).toBe(true);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await button("Cancel").trigger("click");
  await flushPromises();
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

it("restores the saved locale and ignores consumed or composing Escape", async () => {
  const input = host.get('input[type="search"]');
  for (const attrs of [{ isComposing: true }, {}]) {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...attrs });
    if (!attrs.isComposing) event.preventDefault();
    input.element.dispatchEvent(event);
    await nextTick();
    expect(host.findComponent(SettingsDialog).exists()).toBe(true);
  }
  host.findComponent(SettingsDialog).findAllComponents(Select)[1]!.vm.$emit("update:modelValue", "zh-CN");
  await nextTick();
  expect(document.documentElement.lang).toBe("zh-CN");
  await input.trigger("keydown", { key: "Escape" });
  expect(document.documentElement.lang).toBe("en");
});

it("invalidates old Git test results on path edits and permits a new test", async () => {
  await host.findAll("nav button")[1]!.trigger("click");
  const input = host.get('input[placeholder="Leave empty to use git from PATH"]');
  const old = deferred<any>();
  const latest = deferred<any>();
  backend.gitTestExecutable.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  await input.setValue("old-git.exe");
  await button("Test").trigger("click");
  await button("Test").trigger("click");
  expect(backend.gitTestExecutable).toHaveBeenCalledTimes(1);
  await input.setValue("new-git.exe");
  await button("Test").trigger("click");
  old.resolve({ path: "old-git.exe", version: "2.49" });
  await flushPromises();
  expect(host.find('[role="status"]').exists()).toBe(false);
  expect(button("Test").attributes("disabled")).toBeDefined();
  latest.reject({ code: "gitNotFound" });
  await flushPromises();
  expect(host.get('[role="status"]').text()).toContain("Git not found");
  expect(button("Test").attributes("disabled")).toBeUndefined();
  await input.setValue("fixed-git.exe");
  expect(host.find('[role="status"]').exists()).toBe(false);
});

it.each(["", "1.5", "1441"])("blocks invalid fetch interval %s and accepts zero", async (value) => {
  await host.findAll("nav button")[1]!.trigger("click");
  const input = host.get('input[type="number"]');
  await input.setValue(value);
  expect(input.attributes("aria-invalid")).toBe("true");
  expect(host.get('[role="alert"]').text()).toContain("1440");
  await button("OK").trigger("click");
  expect(backend.settingsSet).not.toHaveBeenCalled();
  await input.setValue("0");
  await button("Apply").trigger("click");
  await flushPromises();
  expect(backend.settingsSet.mock.calls[0]![0].git.autoFetchMinutes).toBe(0);
});

it("associates each editable field with its visible title", async () => {
  for (const page of [0, 1, 2]) {
    await host.findAll("nav button")[page]!.trigger("click");
    for (const control of host.findAll('fieldset input, fieldset [role="combobox"]')) {
      const label = host.findAll("label").find((item) => item.attributes("for") === control.attributes("id"));
      expect(label?.text()).toBeTruthy();
    }
  }
});
