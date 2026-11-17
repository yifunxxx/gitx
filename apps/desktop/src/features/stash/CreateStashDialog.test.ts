import { afterEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import CreateStashDialog from "./CreateStashDialog.vue";

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

function file(path: string, kind: "modified" | "untracked" = "modified") {
  return {
    path,
    origPath: null,
    indexStatus: kind === "untracked" ? "?" : ".",
    worktreeStatus: kind === "untracked" ? "?" : "M",
    kind,
  };
}

function mountDialog(props: Record<string, unknown> = {}) {
  mocks.changes = reactive({
    staged: [file("staged.txt")],
    unstaged: [file("local.txt")],
    unversioned: [file("new.txt", "untracked")],
    changed: [file("staged.txt"), file("local.txt")],
  });
  return mount(CreateStashDialog, { props, attachTo: document.body });
}

function optionBoxes(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('input[type="checkbox"]')
    .filter((box) => !box.attributes("aria-label"));
}

it("preselects the opening context and submits adjusted paths", async () => {
  const wrapper = mountDialog({ initialPaths: ["local.txt"], includeUntracked: false });
  await flushPromises();
  const checked = wrapper
    .findAll('input[type="checkbox"]')
    .filter((box) => (box.element as HTMLInputElement).checked && box.attributes("aria-label"))
    .map((box) => box.attributes("aria-label"));
  expect(checked).toEqual(["local.txt"]);
  await wrapper.get('input:not([type="checkbox"]):not([type="search"])').setValue("  selected files  ");
  await wrapper
    .findAll('input[type="checkbox"]')
    .find((box) => box.attributes("aria-label") === "staged.txt")!
    .setValue(true);
  await optionBoxes(wrapper)[1]!.setValue(true);
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(
    {
      message: "selected files",
      includeUntracked: false,
      keepIndex: true,
      paths: ["local.txt", "staged.txt"],
    },
    42,
  );
});

it("cancels without returning creation options", async () => {
  const wrapper = mountDialog();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "common.cancel")!
    .trigger("click");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 42);
});

it("requires at least one selected path", async () => {
  const wrapper = mountDialog({ initialPaths: ["local.txt"] });
  await flushPromises();
  await wrapper
    .findAll('input[type="checkbox"]')
    .find((box) => box.attributes("aria-label") === "local.txt")!
    .setValue(false);
  expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeDefined();
});
