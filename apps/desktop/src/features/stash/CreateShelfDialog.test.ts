import { afterEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import CreateShelfDialog from "./CreateShelfDialog.vue";

const mocks = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: mocks.close,
  useDialogState: () => ({ value: { id: 42 } }),
}));
enableAutoUnmount(afterEach);
afterEach(() => vi.clearAllMocks());

it("submits a name and the chosen keep-local option to its own dialog", async () => {
  const wrapper = mount(CreateShelfDialog, { props: { count: 2 } });
  expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false);
  await wrapper.get('input:not([type="checkbox"])').setValue("  selected work  ");
  await wrapper.get('input[type="checkbox"]').setValue(true);
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(
    { message: "selected work", keepChanges: true },
    42,
  );
});

it("uses the default name for an empty value and supports cancellation", async () => {
  const wrapper = mount(CreateShelfDialog, { props: { count: 1 } });
  await wrapper.get('input:not([type="checkbox"])').setValue("  ");
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).toHaveBeenLastCalledWith(
    { message: "shelf.defaultMessage", keepChanges: false },
    42,
  );
  await wrapper.get('button[type="button"]').trigger("click");
  expect(mocks.close).toHaveBeenLastCalledWith(null, 42);
});
