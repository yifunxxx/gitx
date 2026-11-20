import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { useWorkspaceStore } from "./workspaceStore";
import { useWorktreesStore } from "./worktreesStore";
import WorktreesView from "@/features/worktrees/WorktreesView.vue";

const m = vi.hoisted(() => ({
  backend: {
    workspaceOpen: vi.fn(),
    workspaceRecent: vi.fn(),
    worktreeList: vi.fn(),
    worktreePrunePreview: vi.fn(),
    worktreePrune: vi.fn(),
    worktreeAdd: vi.fn(),
  },
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m.backend }));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: m.confirm }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useDialog", () => ({ openDialog: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const openResult = (path: string) => ({
  path,
  isRepo: true,
  toplevel: path,
  gitDir: `${path}/.git`,
  commonDir: `${path}/.git`,
  roots: [],
});
const preview = {
  paths: ["stale-feature"],
  dryRunOutput: "Removing worktrees/stale-feature: gitdir file points to non-existent location",
};

beforeEach(async () => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  m.backend.workspaceOpen.mockImplementation(async ({ path }) => openResult(path));
  m.backend.workspaceRecent.mockResolvedValue({ paths: [] });
  m.backend.worktreePrunePreview.mockResolvedValue(preview);
  m.backend.worktreePrune.mockResolvedValue(preview);
  m.backend.worktreeList.mockResolvedValue([]);
  m.backend.worktreeAdd.mockResolvedValue({ worktreePath: "new-tree", openAfter: false });
  m.confirm.mockResolvedValue(false);
  await useWorkspaceStore().openFolder("A");
});

it("suppresses repeated prune requests while the preview is pending", async () => {
  const pendingPreview = deferred<typeof preview>();
  m.backend.worktreePrunePreview.mockReturnValue(pendingPreview.promise);
  const store = useWorktreesStore();
  const first = store.prune();
  const second = store.prune();
  pendingPreview.resolve(preview);
  await Promise.all([first, second]);
  expect(m.backend.worktreePrunePreview).toHaveBeenCalledTimes(1);
  expect(m.confirm).toHaveBeenCalledTimes(1);
  expect(m.backend.worktreePrune).not.toHaveBeenCalled();
});

it("remains busy through preview and confirmation and releases on cancel", async () => {
  const pendingPreview = deferred<typeof preview>();
  const confirmation = deferred<boolean>();
  m.backend.worktreePrunePreview.mockReturnValue(pendingPreview.promise);
  m.confirm.mockReturnValue(confirmation.promise);
  const store = useWorktreesStore();
  const pending = store.prune();
  const previewBusy = store.busy;
  pendingPreview.resolve(preview);
  await flushPromises();
  const confirmationBusy = store.busy;
  confirmation.resolve(false);
  await pending;
  expect({ previewBusy, confirmationBusy, finalBusy: store.busy }).toEqual({
    previewBusy: true,
    confirmationBusy: true,
    finalBusy: false,
  });
  expect(m.backend.worktreePrune).not.toHaveBeenCalled();
  expect(m.backend.worktreeList).not.toHaveBeenCalled();
  expect(m.toast).not.toHaveBeenCalled();
});

it("prevents a competing worktree creation before prune confirmation finishes", async () => {
  const confirmation = deferred<boolean>();
  m.confirm.mockReturnValue(confirmation.promise);
  const store = useWorktreesStore();
  const pending = store.prune();
  await flushPromises();
  await store.create({ worktreePath: "new-tree", startRef: "main" });
  const second = store.prune();
  confirmation.resolve(false);
  await Promise.all([pending, second]);
  expect(m.backend.worktreeAdd).not.toHaveBeenCalled();
  expect(m.backend.worktreePrunePreview).toHaveBeenCalledTimes(1);
  expect(m.confirm).toHaveBeenCalledTimes(1);
});

it("drops a late preview when newer navigation has started but the path has not changed", async () => {
  const pendingPreview = deferred<typeof preview>();
  const opening = deferred<ReturnType<typeof openResult>>();
  m.backend.worktreePrunePreview.mockReturnValue(pendingPreview.promise);
  m.backend.workspaceOpen.mockReturnValueOnce(opening.promise);
  m.confirm.mockResolvedValue(true);
  const workspace = useWorkspaceStore();
  const store = useWorktreesStore();
  const pending = store.prune();
  const navigation = workspace.openFolder("B");
  expect(workspace.repoPath).toBe("A");
  pendingPreview.resolve(preview);
  await pending;
  opening.resolve(openResult("B"));
  await navigation;
  expect(m.confirm).not.toHaveBeenCalled();
  expect(m.backend.worktreePrune).not.toHaveBeenCalled();
  expect(m.toast).not.toHaveBeenCalled();
  expect(store.busy).toBe(false);
});

it.each(["pending other folder", "same folder reopened"])(
  "invalidates an old confirmation after %s",
  async (kind) => {
    const confirmation = deferred<boolean>();
    const opening = deferred<ReturnType<typeof openResult>>();
    m.confirm.mockReturnValue(confirmation.promise);
    const workspace = useWorkspaceStore();
    const store = useWorktreesStore();
    const pending = store.prune();
    await flushPromises();
    expect(m.confirm).toHaveBeenCalledTimes(1);
    let navigation: Promise<unknown> | undefined;
    if (kind === "pending other folder") {
      m.backend.workspaceOpen.mockReturnValueOnce(opening.promise);
      navigation = workspace.openFolder("B");
    } else {
      await workspace.openFolder("A");
    }
    expect(workspace.repoPath).toBe("A");
    confirmation.resolve(true);
    await pending;
    if (navigation) {
      opening.resolve(openResult("B"));
      await navigation;
    }
    expect(m.backend.worktreePrune).not.toHaveBeenCalled();
    expect(m.backend.worktreeList).not.toHaveBeenCalled();
    expect(m.toast).not.toHaveBeenCalled();
    expect(store.busy).toBe(false);
  },
);

it("does not publish a late preview error after same-path navigation", async () => {
  const pendingPreview = deferred<typeof preview>();
  m.backend.worktreePrunePreview.mockReturnValueOnce(pendingPreview.promise);
  const store = useWorktreesStore();
  const pending = store.prune();
  await useWorkspaceStore().openFolder("A");
  pendingPreview.reject(new Error("old repository preview failure"));
  await pending;
  expect(store.error).toBeNull();
  expect(m.toast).not.toHaveBeenCalled();
  expect(store.busy).toBe(false);
});

it("clears a preview failure and allows retry without an unnecessary refresh on cancel", async () => {
  m.backend.worktreePrunePreview.mockRejectedValueOnce(new Error("preview failed"));
  const store = useWorktreesStore();
  await store.prune();
  expect(store.error).toBe("preview failed");
  expect(store.busy).toBe(false);
  await store.prune();
  expect(store.error).toBeNull();
  expect(m.backend.worktreePrunePreview).toHaveBeenCalledTimes(2);
  expect(m.confirm).toHaveBeenCalledTimes(1);
  expect(m.backend.worktreePrune).not.toHaveBeenCalled();
  expect(m.backend.worktreeList).not.toHaveBeenCalled();
});

it("reports an empty preview without confirmation or repository refresh", async () => {
  m.backend.worktreePrunePreview.mockResolvedValueOnce({ paths: [], dryRunOutput: "  " });
  const store = useWorktreesStore();
  await store.prune();
  expect(m.confirm).not.toHaveBeenCalled();
  expect(m.backend.worktreePrune).not.toHaveBeenCalled();
  expect(m.backend.worktreeList).not.toHaveBeenCalled();
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({ title: "worktrees.nothingToPrune" });
  expect(store.busy).toBe(false);
});

it("prunes and refreshes exactly once after a current confirmation", async () => {
  m.confirm.mockResolvedValue(true);
  const completion = deferred<typeof preview>();
  m.backend.worktreePrune.mockReturnValueOnce(completion.promise);
  const store = useWorktreesStore();
  const pending = store.prune();
  await flushPromises();
  expect(store.busy).toBe(true);
  expect(m.backend.worktreePrune).toHaveBeenCalledExactlyOnceWith({ path: "A" });
  await store.prune();
  await store.create({ worktreePath: "new-tree", startRef: "main" });
  expect(m.backend.worktreePrunePreview).toHaveBeenCalledTimes(1);
  expect(m.backend.worktreeAdd).not.toHaveBeenCalled();
  completion.resolve(preview);
  await pending;
  expect(m.backend.worktreeList).toHaveBeenCalledExactlyOnceWith({ path: "A" });
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({ title: "worktrees.pruned" });
  expect(store.busy).toBe(false);
});

it("disables worktree commands in the view throughout prune preparation and restores them on cancel", async () => {
  const pendingPreview = deferred<typeof preview>();
  const confirmation = deferred<boolean>();
  m.backend.worktreePrunePreview.mockReturnValueOnce(pendingPreview.promise);
  m.confirm.mockReturnValueOnce(confirmation.promise);
  const wrapper = mount(WorktreesView);
  await flushPromises();
  const prune = wrapper.findAll("button").find((button) => button.text() === "worktrees.prune")!;
  const create = wrapper.findAll("button").find((button) => button.text() === "worktrees.new")!;
  const openRef = wrapper.findAll("button").find((button) => button.text() === "worktrees.openRef")!;
  const disabledState = () => ({
    prune: (prune.element as HTMLButtonElement).disabled,
    create: (create.element as HTMLButtonElement).disabled,
    openRef: (openRef.element as HTMLButtonElement).disabled,
    selectedActions: (wrapper.get("fieldset").element as HTMLFieldSetElement).disabled,
  });
  const loadingState = () => ({
    busy: prune.attributes("aria-busy"),
    status: prune.find('[role="status"]').exists() ? prune.get('[role="status"]').text() : null,
    spinner: prune.find("svg.animate-spin[aria-hidden=true]").exists(),
  });
  await prune.trigger("click");
  const duringPreview = disabledState();
  const previewLoading = loadingState();
  pendingPreview.resolve(preview);
  await flushPromises();
  const duringConfirmation = disabledState();
  const confirmationLoading = loadingState();
  confirmation.resolve(false);
  await flushPromises();
  const afterCancel = disabledState();
  const cancelledLoading = loadingState();
  wrapper.unmount();
  expect(duringPreview).toEqual({ prune: true, create: true, openRef: true, selectedActions: true });
  expect(duringConfirmation).toEqual(duringPreview);
  expect(afterCancel).toEqual({ prune: false, create: false, openRef: false, selectedActions: false });
  expect(previewLoading).toEqual({ busy: "true", status: "common.loading", spinner: true });
  expect(confirmationLoading).toEqual(previewLoading);
  expect(cancelledLoading).toEqual({ busy: "false", status: null, spinner: false });
  expect(m.backend.worktreePrune).not.toHaveBeenCalled();
});

it("does not let an old repository's completion release another repository's pending prune", async () => {
  const oldPreview = deferred<typeof preview>();
  const newPreview = deferred<typeof preview>();
  m.backend.worktreePrunePreview
    .mockReturnValueOnce(oldPreview.promise)
    .mockReturnValueOnce(newPreview.promise);
  const store = useWorktreesStore();
  const previous = store.prune();
  await useWorkspaceStore().openFolder("B");
  const current = store.prune();
  oldPreview.resolve(preview);
  await previous;
  const stateAfterOldCompletion = { busy: store.busy, pruning: store.pruning };
  const repeated = store.prune();
  newPreview.resolve(preview);
  await Promise.all([current, repeated]);
  expect(stateAfterOldCompletion).toEqual({ busy: true, pruning: true });
  expect(m.backend.worktreePrunePreview.mock.calls).toEqual([[{ path: "A" }], [{ path: "B" }]]);
  expect(m.confirm).toHaveBeenCalledTimes(1);
  expect(store.busy).toBe(false);
  expect(Boolean(store.pruning)).toBe(false);
});

it("releases a failed write and allows a fresh preview and successful retry", async () => {
  m.confirm.mockResolvedValue(true);
  m.backend.worktreePrune.mockRejectedValueOnce(new Error("prune failed"));
  const store = useWorktreesStore();
  await store.prune();
  expect(store.error).toBe("prune failed");
  expect(store.busy).toBe(false);
  expect(Boolean(store.pruning)).toBe(false);
  expect(m.backend.worktreeList).not.toHaveBeenCalled();
  expect(m.toast).not.toHaveBeenCalledWith({ title: "worktrees.pruned" });
  m.toast.mockClear();
  await store.prune();
  expect(m.backend.worktreePrunePreview).toHaveBeenCalledTimes(2);
  expect(m.backend.worktreePrune).toHaveBeenCalledTimes(2);
  expect(m.backend.worktreeList).toHaveBeenCalledTimes(1);
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({ title: "worktrees.pruned" });
  expect(store.error).toBeNull();
  expect(store.busy).toBe(false);
});

it("preserves successful prune feedback when only its follow-up list refresh fails", async () => {
  m.confirm.mockResolvedValue(true);
  m.backend.worktreeList.mockRejectedValueOnce(new Error("list refresh failed"));
  const store = useWorktreesStore();
  await store.prune();
  expect(m.backend.worktreePrune).toHaveBeenCalledExactlyOnceWith({ path: "A" });
  expect(m.backend.worktreeList).toHaveBeenCalledTimes(1);
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({ title: "worktrees.pruned" });
  expect(store.error).toBe("list refresh failed");
  expect(store.busy).toBe(false);
  expect(Boolean(store.pruning)).toBe(false);
});

it("finishes an already-started write without stale feedback after same-path navigation", async () => {
  m.confirm.mockResolvedValue(true);
  const completion = deferred<typeof preview>();
  m.backend.worktreePrune.mockReturnValueOnce(completion.promise);
  const store = useWorktreesStore();
  const pending = store.prune();
  await flushPromises();
  expect(m.backend.worktreePrune).toHaveBeenCalledExactlyOnceWith({ path: "A" });
  await useWorkspaceStore().openFolder("A");
  completion.resolve(preview);
  await pending;
  expect(m.backend.worktreeList).not.toHaveBeenCalled();
  expect(m.toast).not.toHaveBeenCalled();
  expect(store.busy).toBe(false);
  expect(Boolean(store.pruning)).toBe(false);
});

it("ignores a late post-prune list while newer folder navigation is still pending", async () => {
  m.confirm.mockResolvedValue(true);
  const listing = deferred<Array<{ path: string }>>();
  const opening = deferred<ReturnType<typeof openResult>>();
  m.backend.worktreeList.mockReturnValueOnce(listing.promise);
  const workspace = useWorkspaceStore();
  const store = useWorktreesStore();
  const pending = store.prune();
  await flushPromises();
  expect(m.backend.worktreeList).toHaveBeenCalledExactlyOnceWith({ path: "A" });
  m.backend.workspaceOpen.mockReturnValueOnce(opening.promise);
  const navigation = workspace.openFolder("B");
  expect(workspace.repoPath).toBe("A");
  listing.resolve([{ path: "stale-A-worktree" }]);
  await pending;
  const afterList = { paths: store.items.map((item) => item.path), error: store.error, loading: store.loading };
  opening.resolve(openResult("B"));
  await navigation;
  expect(afterList).toEqual({ paths: [], error: null, loading: false });
  expect(m.backend.worktreePrune).toHaveBeenCalledTimes(1);
  expect(store.busy).toBe(false);
});

it("ignores a late post-prune list error after the same folder was reopened", async () => {
  m.confirm.mockResolvedValue(true);
  const listing = deferred<unknown[]>();
  m.backend.worktreeList.mockReturnValueOnce(listing.promise);
  const store = useWorktreesStore();
  const pending = store.prune();
  await flushPromises();
  expect(m.backend.worktreeList).toHaveBeenCalledExactlyOnceWith({ path: "A" });
  await useWorkspaceStore().openFolder("A");
  listing.reject(new Error("old session list failure"));
  await pending;
  expect(store.error).toBeNull();
  expect(store.loading).toBe(false);
  expect(store.busy).toBe(false);
  expect(m.backend.worktreePrune).toHaveBeenCalledTimes(1);
});
