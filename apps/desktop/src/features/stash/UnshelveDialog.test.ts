import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import UnshelveDialog from "./UnshelveDialog.vue";
import PathChecklist from "@/components/common/PathChecklist.vue";

const mocks = vi.hoisted(() => ({ close: vi.fn(), store: {} as any, workspace: {} as any }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: mocks.close,
  useDialogState: () => ({ value: { id: 42 } }),
}));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => mocks.store }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace = reactive({
    repoPath: "A",
    isRepo: true,
    navigation: 0,
    navigationToken() {
      return this.navigation;
    },
  });
  mocks.store = reactive({
    shelves: [
      { id: "saved", message: "saved work", paths: ["src/a.txt", "src/b.txt", "other.txt"] },
    ],
    busy: false,
    error: null,
    unshelveSelected: vi.fn().mockResolvedValue({ ok: true, result: { applied: [], failed: [] } }),
  });
});
afterEach(() => {
  document.body.innerHTML = "";
});
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
const create = () =>
  mount(UnshelveDialog, {
    props: { path: "A", id: "saved", navigation: 0, removeApplied: true },
    attachTo: document.body,
  });

it("uses the shared checklist for list/tree/folder selection and submits exactly selected paths", async () => {
  const wrapper = create();
  expect(wrapper.findComponent(PathChecklist).exists()).toBe(true);
  await wrapper.get("[data-list-mode]").trigger("click");
  expect(wrapper.find('[role="tree"]').exists()).toBe(true);
  await wrapper.get('input[aria-label="src"]').setValue(false);
  expect(wrapper.get('[data-path="src"]').attributes("aria-checked")).toBe("false");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(mocks.store.unshelveSelected).toHaveBeenCalledExactlyOnceWith(
    "saved",
    ["other.txt"],
    true,
  );
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(true, 42);
});

it("submits edited remove-applied option and can select individual files", async () => {
  const wrapper = create();
  await wrapper.get('input[aria-label="other.txt"]').setValue(false);
  await wrapper
    .findAll('input[type="checkbox"]')
    .find((b) => !b.attributes("aria-label"))!
    .setValue(false);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(mocks.store.unshelveSelected).toHaveBeenCalledExactlyOnceWith(
    "saved",
    ["src/a.txt", "src/b.txt"],
    false,
  );
});

it("rejects empty selection and cancellation does not write", async () => {
  const wrapper = create();
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "rewrite.clearSelection")!
    .trigger("click");
  expect(wrapper.get("[data-unshelve-submit]").attributes("disabled")).toBeDefined();
  await wrapper.get("form").trigger("submit");
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "common.cancel")!
    .trigger("click");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 42);
  expect(mocks.store.unshelveSelected).not.toHaveBeenCalled();
});

it("keeps the dialog open while pending and blocks duplicate submit, Escape and Cancel", async () => {
  const pending = deferred();
  mocks.store.unshelveSelected.mockReturnValue(pending.promise);
  const wrapper = create();
  await wrapper.get("form").trigger("submit");
  expect(wrapper.text()).toContain("shelf.restoringFiles");
  expect(wrapper.findAll("input").every((b) => b.attributes("disabled") !== undefined)).toBe(true);
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  wrapper.get("form").element.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  await wrapper.get("form").trigger("submit");
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "common.cancel")!
    .trigger("click");
  expect(mocks.store.unshelveSelected).toHaveBeenCalledOnce();
  expect(mocks.close).not.toHaveBeenCalled();
  pending.resolve({ ok: true, result: null });
  await flushPromises();
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(true, 42);
});

it("does not implicitly submit when Enter is used in search or checkboxes", () => {
  const wrapper = create();
  for (const input of wrapper.findAll("input")) {
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  }
  expect(mocks.store.unshelveSelected).not.toHaveBeenCalled();
});

it("retains failures in the dialog and retries without applying successful paths again", async () => {
  mocks.store.error = "one file conflicted";
  mocks.store.unshelveSelected.mockResolvedValueOnce({
    ok: false,
    result: { applied: ["src/a.txt"], failed: ["src/b.txt"] },
  });
  const wrapper = create();
  await wrapper.get('input[aria-label="other.txt"]').setValue(false);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(wrapper.get('[role="alert"]').text()).toBe("one file conflicted");
  expect((wrapper.get('input[aria-label="src/a.txt"]').element as HTMLInputElement).checked).toBe(
    false,
  );
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(mocks.store.unshelveSelected).toHaveBeenLastCalledWith("saved", ["src/b.txt"], true);
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(true, 42);
});

it("retains selection on an invocation error and permits retry", async () => {
  mocks.store.unshelveSelected.mockRejectedValueOnce(new Error("index locked"));
  const wrapper = create();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("index locked");
  expect(mocks.close).not.toHaveBeenCalled();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(mocks.store.unshelveSelected).toHaveBeenCalledTimes(2);
  expect(mocks.close).toHaveBeenCalledWith(true, 42);
});

it("prunes removed paths without selecting newly added files during refresh", async () => {
  const wrapper = create();
  await wrapper.get('input[aria-label="other.txt"]').setValue(false);
  mocks.store.shelves[0].paths = ["src/a.txt", "other.txt", "new.txt"];
  await flushPromises();
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(mocks.store.unshelveSelected).toHaveBeenCalledExactlyOnceWith(
    "saved",
    ["src/a.txt"],
    true,
  );
});

it("disables restoration if the Shelf was removed", async () => {
  const wrapper = create();
  mocks.store.shelves = [];
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("shelf.selectionUnavailable");
  await wrapper.get("form").trigger("submit");
  expect(mocks.store.unshelveSelected).not.toHaveBeenCalled();
});

it.each(["repository", "navigation", "unmount"])(
  "ignores late results after %s",
  async (reason) => {
    const pending = deferred();
    mocks.store.unshelveSelected.mockReturnValue(pending.promise);
    const wrapper = create();
    await wrapper.get("form").trigger("submit");
    if (reason === "repository") mocks.workspace.repoPath = "B";
    else if (reason === "navigation") mocks.workspace.navigation++;
    else wrapper.unmount();
    await flushPromises();
    mocks.close.mockClear();
    pending.resolve({ ok: true, result: { applied: ["src/a.txt"], failed: [] } });
    await flushPromises();
    expect(mocks.close).not.toHaveBeenCalled();
  },
);

it("closes only its own dialog on same-path navigation and refuses further submission", async () => {
  const wrapper = create();
  mocks.workspace.navigation++;
  await flushPromises();
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 42);
  await wrapper.get("form").trigger("submit");
  expect(mocks.store.unshelveSelected).not.toHaveBeenCalled();
});

it("closes if navigation changed before the asynchronous component mounted", async () => {
  mocks.workspace.navigation++;
  const wrapper = create();
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 42);
  await wrapper.get('form').trigger('submit');
  expect(mocks.store.unshelveSelected).not.toHaveBeenCalled();
});

it("prevents submission while another Shelf operation is busy", async () => {
  const wrapper = create();
  mocks.store.busy = true;
  await flushPromises();
  await wrapper.get("form").trigger("submit");
  expect(mocks.store.unshelveSelected).not.toHaveBeenCalled();
});
