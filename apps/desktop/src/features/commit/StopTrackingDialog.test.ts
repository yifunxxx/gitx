import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import StopTrackingDialog from "./StopTrackingDialog.vue";

const mocks = vi.hoisted(() => ({ close: vi.fn(), ws: {} as any }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: mocks.close,
  useDialogState: () => ({ value: { id: 7 } }),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ws = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    generation: 1,
    navigationToken() {
      return this.generation;
    },
  });
  wrapper = mount(StopTrackingDialog, {
    props: { count: 2 },
    global: {
      stubs: {
        Button: { template: "<button><slot /></button>" },
      },
    },
  });
});
afterEach(() => wrapper.unmount());
it.each([false, true])("returns the checkbox only on explicit submit (%s)", async (value) => {
  await wrapper.get('input[type="checkbox"]').setValue(value);
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith({ addToGitignore: value }, 7);
});
it.each(["button", "escape"])("returns cancellation on %s", async (how) => {
  await wrapper.get('input[type="checkbox"]').setValue(true);
  if (how === "button") await wrapper.get('button[type="button"]').trigger("click");
  else await wrapper.get("form").trigger("keydown", { key: "Escape" });
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 7);
});
it("closes its own dialog on navigation and ignores a late submit", async () => {
  mocks.ws.generation++;
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 7);
});
