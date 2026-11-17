import { afterEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import CreateShelfDialog from "./CreateShelfDialog.vue";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  changes: {} as any,
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: mocks.close,
  useDialogState: () => ({ value: { id: 42 } }),
}));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
enableAutoUnmount(afterEach);
afterEach(() => vi.clearAllMocks());

function file(path: string) {
  return {
    path,
    origPath: null,
    indexStatus: ".",
    worktreeStatus: "M",
    kind: "modified" as const,
  };
}

it("submits a name, keep-local option, and adjusted paths", async () => {
  mocks.changes = reactive({
    changed: [file("first.txt"), file("second.txt"), file("third.txt")],
  });
  const wrapper = mount(CreateShelfDialog, {
    props: { initialPaths: ["first.txt", "second.txt"] },
    attachTo: document.body,
  });
  await flushPromises();
  expect(
    wrapper
      .findAll('input[type="checkbox"]')
      .filter((box) => (box.element as HTMLInputElement).checked),
  ).toHaveLength(2);
  await wrapper
    .findAll('input[type="checkbox"]')
    .find((box) => box.attributes("aria-label") === "third.txt")!
    .setValue(true);
  await wrapper.get('input:not([type="checkbox"]):not([type="search"])').setValue("  selected work  ");
  await wrapper
    .findAll('input[type="checkbox"]')
    .find((box) => !box.attributes("aria-label"))!
    .setValue(true);
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(
    {
      message: "selected work",
      keepChanges: true,
      paths: expect.arrayContaining(["first.txt", "second.txt", "third.txt"]),
    },
    42,
  );
});

it("uses the default name for an empty value and supports cancellation", async () => {
  mocks.changes = reactive({ changed: [file("only.txt")] });
  const wrapper = mount(CreateShelfDialog, {
    props: { initialPaths: ["only.txt"] },
    attachTo: document.body,
  });
  await wrapper.get('input:not([type="checkbox"]):not([type="search"])').setValue("  ");
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).toHaveBeenLastCalledWith(
    { message: "shelf.defaultMessage", keepChanges: false, paths: ["only.txt"] },
    42,
  );
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "common.cancel")!
    .trigger("click");
  expect(mocks.close).toHaveBeenLastCalledWith(null, 42);
});
