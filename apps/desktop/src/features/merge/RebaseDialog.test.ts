import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, reactive, shallowRef } from "vue";
import RebaseDialog from "./RebaseDialog.vue";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  rewrite: {} as any,
  branches: {} as any,
  dialog: {} as any,
  close: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => mocks.branches }));
vi.mock("@/composables/useDialog", () => ({
  useDialogState: () => mocks.dialog,
  useDialogStack: () => computed(() => [mocks.dialog.value]),
  closeDialog: mocks.close,
  openDialog: mocks.open,
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

let wrapper: ReturnType<typeof mount> | undefined;
const submit = () => wrapper!.findAll("button").at(-1)!;
const checkbox = (name: string) =>
  wrapper!
    .findAll("label")
    .find((label) => label.text() === name)!
    .get("input");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    navigation: 1,
    navigationToken() {
      return this.navigation;
    },
    branch: { head: "feature" },
  });
  mocks.dialog = shallowRef({ id: 42 });
  mocks.rewrite = reactive({ busy: false, rebase: vi.fn() });
  mocks.branches = reactive({
    refresh: vi.fn().mockResolvedValue(undefined),
    refs: { local: [{ name: "main", isHead: false }], remote: [] },
  });
});
afterEach(() => wrapper?.unmount());

it("retains supported options when opening the interactive editor and validates onto", async () => {
  wrapper = mount(RebaseDialog);
  await flushPromises();
  await checkbox("--interactive").setValue(true);
  await checkbox("--root").setValue(true);
  await checkbox("--rebase-merges").setValue(true);
  await checkbox("--autosquash").setValue(true);
  await checkbox("--onto").setValue(true);
  expect(submit().attributes("disabled")).toBeDefined();
  expect(checkbox("--keep-empty").attributes("disabled")).toBeDefined();
  expect(checkbox("--update-refs").attributes("disabled")).toBeDefined();
  await wrapper.get('[aria-label="merge.ontoTarget"]').setValue("destination");
  await submit().trigger("click");
  expect(mocks.open).toHaveBeenCalledWith(expect.anything(), {
    upstream: undefined,
    root: true,
    onto: "destination",
    rebaseMerges: true,
    autosquash: true,
  });
  expect(mocks.rewrite.rebase).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledWith(false, 42);
});

it("keeps input and allows retry after failure or dirty-worktree cancellation", async () => {
  mocks.rewrite.rebase
    .mockRejectedValueOnce(new Error("index locked"))
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ outcome: "success" });
  wrapper = mount(RebaseDialog);
  await flushPromises();
  await submit().trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("index locked");
  expect(mocks.close).not.toHaveBeenCalled();
  await submit().trigger("click");
  await flushPromises();
  expect(mocks.close).not.toHaveBeenCalled();
  await submit().trigger("click");
  await flushPromises();
  expect(mocks.close).toHaveBeenCalledWith(true, 42);
});

it("prevents duplicate starts and late completion closing a replacement dialog", async () => {
  const pending = deferred<unknown>();
  mocks.rewrite.rebase.mockReturnValue(pending.promise);
  wrapper = mount(RebaseDialog);
  await flushPromises();
  await submit().trigger("click");
  await submit().trigger("click");
  await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
  expect(mocks.rewrite.rebase).toHaveBeenCalledOnce();
  expect(mocks.close).not.toHaveBeenCalled();
  mocks.dialog.value = { id: 43 };
  pending.resolve({ outcome: "success" });
  await flushPromises();
  expect(mocks.close).not.toHaveBeenCalled();
});

it("invalidates the dialog after an A-B-A repository switch", async () => {
  const pending = deferred<unknown>();
  mocks.branches.refresh.mockReturnValue(pending.promise);
  wrapper = mount(RebaseDialog);
  mocks.workspace.repoPath = "B";
  mocks.workspace.repoPath = "A";
  pending.resolve(undefined);
  await flushPromises();
  await submit().trigger("click");
  expect(mocks.rewrite.rebase).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
});

it("does not open an interactive child after same-path navigation begins", async () => {
  wrapper = mount(RebaseDialog);
  await flushPromises();
  await checkbox("--interactive").setValue(true);
  ++mocks.workspace.navigation;
  await submit().trigger("click");
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.rewrite.rebase).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledWith(false, 42);
});

it("requires a successful branch reload after initial loading fails", async () => {
  mocks.branches.refresh.mockRejectedValueOnce(new Error("load failed"));
  wrapper = mount(RebaseDialog);
  await flushPromises();
  await checkbox("--root").setValue(true);
  await submit().trigger("click");
  expect(mocks.rewrite.rebase).not.toHaveBeenCalled();
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "empty.retry")!
    .trigger("click");
  await flushPromises();
  await submit().trigger("click");
  expect(mocks.rewrite.rebase).toHaveBeenCalledOnce();
});
