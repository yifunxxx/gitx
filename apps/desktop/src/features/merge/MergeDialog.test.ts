import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive, shallowRef } from "vue";
import MergeDialog from "./MergeDialog.vue";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  rewrite: {} as any,
  branches: {} as any,
  dialog: {} as any,
  close: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => mocks.branches }));
vi.mock("@/composables/useDialog", () => ({
  useDialogState: () => mocks.dialog,
  closeDialog: mocks.close,
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

let wrapper: ReturnType<typeof mount> | undefined;
const submit = () => wrapper!.findAll("button").at(-1)!;
const optionCheckbox = (name: string) =>
  wrapper!
    .findAll("label")
    .find((l) => l.text() === name)!
    .get<HTMLInputElement>("input");
const branchRow = (name: string) =>
  wrapper!.findAll("button").find((b) => b.find(`span[title="${name}"]`).exists())!;
const branchCheckbox = (name: string) => branchRow(name).get<HTMLInputElement>("input");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  mocks.workspace = reactive({ repoPath: "A", navigationToken: () => 1, branch: { head: "main" } });
  mocks.dialog = shallowRef({ id: 42 });
  mocks.rewrite = reactive({ busy: false, merge: vi.fn() });
  mocks.branches = reactive({
    refresh: vi.fn().mockResolvedValue(undefined),
    refs: {
      local: [
        { name: "main", isHead: true },
        { name: "topic", isHead: false },
      ],
    },
  });
});
afterEach(() => {
  wrapper?.unmount();
  vi.unstubAllGlobals();
});

it("waits for branch loading and blocks writes after loading fails", async () => {
  mocks.branches.refresh.mockRejectedValueOnce(new Error("cannot read refs"));
  wrapper = mount(MergeDialog);
  expect(submit().attributes("disabled")).toBeDefined();
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("cannot read refs");
  await submit().trigger("click");
  expect(mocks.rewrite.merge).not.toHaveBeenCalled();
});

it("selects branches with one checkbox interaction and rejects incompatible merge options", async () => {
  wrapper = mount(MergeDialog);
  await flushPromises();
  expect(branchCheckbox("topic").element.checked).toBe(true);
  await branchRow("topic").trigger("click");
  expect(submit().attributes("disabled")).toBeDefined();
  await branchRow("topic").trigger("click");
  await optionCheckbox("merge.squashChanges").setValue(true);
  expect(optionCheckbox("merge.noFastForward").element.disabled).toBe(true);
  expect(optionCheckbox("merge.fastForwardOnly").element.disabled).toBe(true);
  await submit().trigger("click");
  expect(mocks.rewrite.merge).toHaveBeenCalledWith(
    expect.objectContaining({ branches: ["topic"], squash: true, noFf: false, ffOnly: false }),
  );
});

it("retains input after failure and cancellation, and retries only on request", async () => {
  mocks.rewrite.merge
    .mockRejectedValueOnce(new Error("index locked"))
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ outcome: "success" });
  wrapper = mount(MergeDialog);
  await flushPromises();
  await optionCheckbox("merge.customMessage").setValue(true);
  expect(submit().attributes("disabled")).toBeDefined();
  await wrapper.get('[aria-label="merge.commitMessage"]').setValue("keep 中文 message");
  await submit().trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("index locked");
  expect(mocks.close).not.toHaveBeenCalled();
  await submit().trigger("click");
  await flushPromises();
  expect(mocks.close).not.toHaveBeenCalled();
  await submit().trigger("click");
  await flushPromises();
  expect(mocks.rewrite.merge.mock.lastCall[0].message).toBe("keep 中文 message");
  expect(mocks.close).toHaveBeenCalledWith(true, 42);
});

it("prevents duplicate submissions and does not close a replacement dialog", async () => {
  const pending = deferred<unknown>();
  mocks.rewrite.merge.mockReturnValue(pending.promise);
  wrapper = mount(MergeDialog);
  await flushPromises();
  await submit().trigger("click");
  await submit().trigger("click");
  await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
  expect(mocks.rewrite.merge).toHaveBeenCalledOnce();
  expect(mocks.close).not.toHaveBeenCalled();
  mocks.dialog.value = { id: 43 };
  pending.resolve({ outcome: "success" });
  await flushPromises();
  expect(mocks.close).not.toHaveBeenCalled();
});

it("invalidates a pending branch load after repository navigation", async () => {
  const pending = deferred<void>();
  mocks.branches.refresh.mockReturnValue(pending.promise);
  wrapper = mount(MergeDialog);
  mocks.workspace.repoPath = "B";
  mocks.workspace.repoPath = "A";
  pending.resolve();
  await flushPromises();
  await submit().trigger("click");
  expect(mocks.rewrite.merge).not.toHaveBeenCalled();
  expect(mocks.close.mock.calls.every((call) => call[0] === false && call[1] === 42)).toBe(true);
});

it("can be dismissed after a navigation starts but cannot submit to the old repository", async () => {
  wrapper = mount(MergeDialog);
  await flushPromises();
  mocks.workspace.navigationToken = () => 2;
  await submit().trigger("click");
  expect(mocks.rewrite.merge).not.toHaveBeenCalled();
  await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
  expect(mocks.close).toHaveBeenCalledWith(false, 42);
});
