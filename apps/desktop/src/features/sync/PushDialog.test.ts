import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import PushDialog from "./PushDialog.vue";

const mocks = vi.hoisted(() => ({
  ws: {} as { repoPath: string; branch: { head: string } },
  branches: { refresh: vi.fn(), error: null, remotes: [{ name: "origin" }, { name: "backup" }] },
  sync: { previewPush: vi.fn(), push: vi.fn(), pull: vi.fn(), pushing: false },
  close: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => mocks.branches }));
vi.mock("@/stores/syncStore", () => ({ useSyncStore: () => mocks.sync }));
vi.mock("@/composables/useDialog", () => ({ closeDialog: mocks.close, openDialog: mocks.open }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));

const preview = (
  remote = "origin",
  branch = "feature/local",
  target = "review/remote",
  commits = ["new commit"],
) => ({
  remote,
  refs: [{ local: branch, remote, remoteBranch: target }],
  commits,
  setUpstream: false,
  hasRemote: true,
  commitsTruncated: false,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
const mountDialog = () => mount(PushDialog);
const submit = (wrapper: ReturnType<typeof mountDialog>) =>
  wrapper.findAll("button").find((b) => b.text() === "toolbar.push")!;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.ws = reactive({ repoPath: "A", branch: { head: "feature/local" } });
  mocks.branches.refresh.mockResolvedValue(undefined);
  mocks.sync.previewPush.mockResolvedValue(preview());
  mocks.sync.push.mockResolvedValue({ rejected: false });
});
afterEach(() => {
  vi.useRealTimers();
});

it("initializes from the selected branch's upstream and sends both source and destination", async () => {
  const ready = deferred<void>();
  mocks.branches.refresh.mockReturnValue(ready.promise);
  const wrapper = mountDialog();
  expect(wrapper.get<HTMLInputElement>('[aria-label="syncUi.localBranch"]').element.value).toBe(
    "feature/local",
  );
  expect(submit(wrapper).attributes("disabled")).toBeDefined();
  ready.resolve();
  await flushPromises();
  expect(mocks.sync.previewPush).toHaveBeenCalledWith(undefined, "feature/local", undefined);
  expect(wrapper.get<HTMLInputElement>('[aria-label="syncUi.remoteBranch"]').element.value).toBe(
    "review/remote",
  );
  await submit(wrapper).trigger("click");
  expect(mocks.sync.push).toHaveBeenCalledWith(
    expect.objectContaining({
      remote: "origin",
      branch: "feature/local",
      remoteBranch: "review/remote",
    }),
  );
  wrapper.unmount();
});

it("clears stale preview immediately and ignores a late response while target edits debounce", async () => {
  const wrapper = mountDialog();
  await flushPromises();
  const pending = deferred<ReturnType<typeof preview>>();
  mocks.sync.previewPush.mockReturnValueOnce(pending.promise);
  await wrapper.get('[aria-label="syncUi.localBranch"]').setValue("feature/other");
  expect(submit(wrapper).attributes("disabled")).toBeDefined();
  expect(wrapper.text()).not.toContain("new commit");
  await vi.advanceTimersByTimeAsync(250);
  expect(mocks.sync.previewPush).toHaveBeenLastCalledWith(
    "origin",
    "feature/other",
    "review/remote",
  );
  await wrapper.get('[aria-label="syncUi.remoteBranch"]').setValue("release");
  pending.resolve(preview("origin", "feature/other", "review/remote", ["stale result"]));
  await flushPromises();
  expect(wrapper.text()).not.toContain("stale result");
  expect(submit(wrapper).attributes("disabled")).toBeDefined();
  mocks.sync.previewPush.mockResolvedValueOnce(
    preview("origin", "feature/other", "release", ["current result"]),
  );
  await vi.advanceTimersByTimeAsync(250);
  await flushPromises();
  expect(mocks.sync.previewPush).toHaveBeenLastCalledWith("origin", "feature/other", "release");
  expect(wrapper.text()).toContain("current result");
  expect(submit(wrapper).attributes("disabled")).toBeUndefined();
  await wrapper.findAllComponents({ name: "Select" })[0]!.vm.$emit("update:modelValue", "backup");
  await vi.advanceTimersByTimeAsync(250);
  expect(mocks.sync.previewPush).toHaveBeenLastCalledWith("backup", "feature/other", "release");
  wrapper.unmount();
});

it("keeps a failed preview disabled and cancels pending refresh on unmount", async () => {
  const wrapper = mountDialog();
  await flushPromises();
  mocks.sync.previewPush.mockRejectedValueOnce(new Error("unknown branch"));
  await wrapper.get('[aria-label="syncUi.localBranch"]').setValue("missing");
  await vi.advanceTimersByTimeAsync(250);
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("unknown branch");
  expect(submit(wrapper).attributes("disabled")).toBeDefined();
  await wrapper.get('[aria-label="syncUi.localBranch"]').setValue("main");
  const calls = mocks.sync.previewPush.mock.calls.length;
  wrapper.unmount();
  await vi.advanceTimersByTimeAsync(500);
  expect(mocks.sync.previewPush).toHaveBeenCalledTimes(calls);
});

it("invalidates a dialog across A → B → A repository switches", async () => {
  const wrapper = mountDialog();
  await flushPromises();
  mocks.ws.repoPath = "B";
  mocks.ws.repoPath = "A";
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("syncUi.repositoryChanged");
  expect(submit(wrapper).attributes("disabled")).toBeDefined();
  await submit(wrapper).trigger("click");
  expect(mocks.sync.push).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("does not close another dialog or open rejection actions after being dismissed", async () => {
  for (const rejected of [false, true]) {
    const pending = deferred<{ rejected: boolean }>();
    mocks.sync.push.mockReturnValueOnce(pending.promise);
    const wrapper = mountDialog();
    await flushPromises();
    await submit(wrapper).trigger("click");
    wrapper.unmount();
    pending.resolve({ rejected });
    await flushPromises();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  }
});

it("keeps the push dialog open if a retry is rejected again", async () => {
  mocks.sync.push.mockResolvedValue({ rejected: true, message: "rejected" });
  mocks.open.mockResolvedValue("rebase");
  const wrapper = mountDialog();
  await flushPromises();
  await submit(wrapper).trigger("click");
  await flushPromises();
  expect(mocks.sync.pull).toHaveBeenCalledWith({
    remote: "origin",
    branch: "review/remote",
    rebase: true,
  });
  expect(mocks.sync.push).toHaveBeenCalledTimes(2);
  expect(mocks.close).not.toHaveBeenCalled();
  wrapper.unmount();
});
