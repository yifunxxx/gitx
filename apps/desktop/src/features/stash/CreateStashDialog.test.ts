import { afterEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import CreateStashDialog from "./CreateStashDialog.vue";

const mocks = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: mocks.close,
  useDialogState: () => ({ value: { id: 42 } }),
}));
enableAutoUnmount(afterEach);
afterEach(() => vi.clearAllMocks());
it("submits explicit stash options to its own dialog", async () => {
  const wrapper = mount(CreateStashDialog, { props: { includeUntracked: true } });
  await wrapper.get('input:not([type="checkbox"])').setValue("  selected files  ");
  await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true);
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(
    { message: "selected files", includeUntracked: true, keepIndex: true },
    42,
  );
});
it("cancels without returning creation options", async () => {
  const wrapper = mount(CreateStashDialog);
  await wrapper.get('button[type="button"]').trigger("click");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 42);
});
