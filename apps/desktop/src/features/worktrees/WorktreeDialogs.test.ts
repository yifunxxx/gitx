import { beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import CreateWorktreeDialog from "./CreateWorktreeDialog.vue";
import OpenRefWorktreeDialog from "./OpenRefWorktreeDialog.vue";
import WorktreesView from "./WorktreesView.vue";

const mocks = vi.hoisted(() => ({
  defaultPath: vi.fn(),
  close: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
  workspace: { repoPath: "A", isRepo: true },
  store: {
    items: [] as any[],
    selectedPath: null as string | null,
    createOpen: false,
    openRefOpen: false,
    create: vi.fn(),
    openRef: vi.fn(),
    refresh: vi.fn(),
    lock: vi.fn(),
    remove: vi.fn(),
    repositoryToken: () => "A:1",
  },
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({ worktreeDefaultPath: mocks.defaultPath }),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/worktreesStore", () => ({ useWorktreesStore: () => mocks.store }));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: mocks.close,
  useDialogState: () => ({ value: { id: 42 } }),
  openDialog: vi.fn(),
}));
vi.mock("@/composables/useConfirm", () => ({
  confirmDialog: mocks.confirm,
  promptDialog: mocks.prompt,
}));
function deferred() {
  let resolve!: (v: { path: string }) => void;
  const promise = new Promise<{ path: string }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace = reactive({ repoPath: "A", isRepo: true });
  mocks.store.items = [];
  mocks.store.selectedPath = null;
  mocks.defaultPath.mockResolvedValue({ path: "suggested" });
});
it("keeps a manual destination despite a late initial suggestion and branch edits", async () => {
  const initial = deferred();
  mocks.defaultPath.mockReturnValueOnce(initial.promise);
  const wrapper = mount(CreateWorktreeDialog);
  const inputs = wrapper.findAll('input:not([type="checkbox"])');
  await inputs[2]!.setValue("my-location");
  initial.resolve({ path: "late" });
  await flushPromises();
  await inputs[1]!.setValue("new-branch");
  await flushPromises();
  expect((inputs[2]!.element as HTMLInputElement).value).toBe("my-location");
  await wrapper.get("form").trigger("submit");
  expect(mocks.store.create).toHaveBeenCalledWith(
    expect.objectContaining({ worktreePath: "my-location", newBranch: "new-branch", track: false }),
  );
  wrapper.unmount();
});
it("ignores older path suggestions and reports suggestion errors", async () => {
  const old = deferred();
  mocks.defaultPath.mockReturnValueOnce(old.promise);
  const wrapper = mount(CreateWorktreeDialog);
  const inputs = wrapper.findAll('input:not([type="checkbox"])');
  await inputs[1]!.setValue("feature");
  await flushPromises();
  old.resolve({ path: "old" });
  await flushPromises();
  expect((inputs[2]!.element as HTMLInputElement).value).toBe("suggested");
  mocks.defaultPath.mockRejectedValueOnce(new Error("path unavailable"));
  await inputs[1]!.setValue("other");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("path unavailable");
  wrapper.unmount();
});
it("submits the custom ref destination without recalculating or overwriting it", async () => {
  const wrapper = mount(OpenRefWorktreeDialog);
  await flushPromises();
  const inputs = wrapper.findAll("input");
  await inputs[1]!.setValue("12");
  await flushPromises();
  await inputs[3]!.setValue("custom-review-path");
  const calls = mocks.defaultPath.mock.calls.length;
  await wrapper.get("form").trigger("submit");
  expect(mocks.defaultPath).toHaveBeenCalledTimes(calls);
  expect(mocks.store.openRef).toHaveBeenCalledWith({
    worktreePath: "custom-review-path",
    remote: "origin",
    refspec: "refs/pull/12/head",
    reviewName: "12",
  });
  wrapper.unmount();
});
it("dismisses only its own dialog on repository change", async () => {
  const wrapper = mount(CreateWorktreeDialog);
  mocks.workspace.repoPath = "B";
  await flushPromises();
  expect(mocks.close).toHaveBeenCalledWith(null, 42);
  wrapper.unmount();
});
it("does not lock or remove a worktree when its prompt is cancelled", async () => {
  mocks.store.items = [
    {
      path: "linked",
      isMain: false,
      isCurrent: false,
      locked: false,
      head: "abc",
      branch: "feature",
    },
  ];
  mocks.store.selectedPath = "linked";
  const wrapper = mount(WorktreesView);
  mocks.prompt.mockResolvedValue(null);
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "worktrees.lock")!
    .trigger("click");
  await flushPromises();
  expect(mocks.store.lock).not.toHaveBeenCalled();
  mocks.confirm.mockResolvedValue(false);
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "worktrees.remove")!
    .trigger("click");
  await flushPromises();
  expect(mocks.store.remove).not.toHaveBeenCalled();
  mocks.confirm.mockResolvedValue(true);
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "worktrees.remove")!
    .trigger("click");
  await flushPromises();
  expect(mocks.confirm).toHaveBeenCalledTimes(2);
  expect(mocks.store.remove).toHaveBeenCalledWith("linked", false);
  wrapper.unmount();
});

it("keeps a confirmed lock valid across a background list refresh", async () => {
  const target = {
    path: "linked",
    isMain: false,
    isCurrent: false,
    locked: false,
    head: "abc",
    branch: "feature",
  };
  mocks.store.items = [target];
  mocks.store.selectedPath = target.path;
  let confirm!: (reason: string) => void;
  mocks.prompt.mockReturnValue(
    new Promise<string>((resolve) => {
      confirm = resolve;
    }),
  );
  const wrapper = mount(WorktreesView);
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "worktrees.lock")!
    .trigger("click");
  mocks.store.items = [{ ...target }];
  confirm("keep for review");
  await flushPromises();
  expect(mocks.store.lock).toHaveBeenCalledWith("linked", "keep for review");
  wrapper.unmount();
});
