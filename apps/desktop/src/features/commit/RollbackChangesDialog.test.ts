import { afterEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import RollbackChangesDialog from "./RollbackChangesDialog.vue";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  changes: {} as any,
  current: vi.fn(() => true),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: mocks.close,
  useDialogState: () => ({ value: { id: 42 } }),
}));
vi.mock("@/composables/useRepositoryAction", () => ({
  useRepositoryAction: () => () => ({ current: mocks.current }),
}));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
enableAutoUnmount(afterEach);
afterEach(() => vi.clearAllMocks());

function file(path: string) {
  return {
    path,
    origPath: null,
    indexStatus: "M",
    worktreeStatus: ".",
    kind: "modified" as const,
  };
}

it("preselects the opening paths and returns the adjusted set", async () => {
  mocks.changes = reactive({
    staged: [file("first.txt"), file("second.txt")],
    unstaged: [file("third.txt")],
  });
  const wrapper = mount(RollbackChangesDialog, {
    props: { initialPaths: ["first.txt", "second.txt"] },
    attachTo: document.body,
  });
  await flushPromises();
  await wrapper
    .findAll('input[type="checkbox"]')
    .find((box) => box.attributes("aria-label") === "third.txt")!
    .setValue(true);
  await wrapper
    .findAll('input[type="checkbox"]')
    .find((box) => box.attributes("aria-label") === "second.txt")!
    .setValue(false);
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(
    { paths: ["first.txt", "third.txt"] },
    42,
  );
});

it("cancels when the repository source is no longer current", async () => {
  mocks.changes = reactive({ staged: [file("only.txt")], unstaged: [] });
  mocks.current.mockReturnValue(false);
  const wrapper = mount(RollbackChangesDialog, {
    props: { initialPaths: ["only.txt"] },
    attachTo: document.body,
  });
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).not.toHaveBeenCalled();
});
