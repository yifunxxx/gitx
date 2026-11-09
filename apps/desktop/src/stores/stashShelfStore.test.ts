import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useStashShelfStore } from "./stashShelfStore";

const mocks = vi.hoisted(() => ({
  workspace: { repoPath: "A", isRepo: true, navigationToken: (): number => 0 },
  backend: {
    stashList: vi.fn(),
    shelfList: vi.fn(),
    shelfCreate: vi.fn(),
    stashCreate: vi.fn(),
    stashApply: vi.fn(),
    stashDrop: vi.fn(),
    stashPop: vi.fn(),
    stashClear: vi.fn(),
  },
  refresh: vi.fn(),
  conflicts: vi.fn(),
  opState: vi.fn(),
  toast: vi.fn(),
  dialog: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
}));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./settingsStore", () => ({ useSettingsStore: () => ({}) }));
vi.mock("./changesStore", () => ({ useChangesStore: () => ({ refresh: mocks.refresh }) }));
vi.mock("./conflictsStore", () => ({ useConflictsStore: () => ({ refresh: mocks.conflicts }) }));
vi.mock("./rewriteStore", () => ({ useRewriteStore: () => ({ refreshOpState: mocks.opState }) }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/composables/useDialog", () => ({ openDialog: mocks.dialog }));
vi.mock("@/composables/useConfirm", () => ({
  confirmDialog: mocks.confirm,
  promptDialog: mocks.prompt,
}));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
function deferred() {
  let resolve!: (v?: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const entry = (sha: string, index: number) => ({
  sha,
  index,
  message: sha,
  time: 1,
  branch: "main",
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace = reactive({ repoPath: "A", isRepo: true, navigationToken: () => 0 });
  setActivePinia(createPinia());
  mocks.backend.stashList.mockResolvedValue([]);
  mocks.backend.shelfList.mockResolvedValue([]);
  mocks.refresh.mockResolvedValue(undefined);
});
it("keeps the selected SHA when stash indexes change and clears it after removal", async () => {
  const store = useStashShelfStore();
  mocks.backend.stashList.mockResolvedValue([entry("first", 0)]);
  await store.refresh();
  store.selectedStashSha = "first";
  mocks.backend.stashList.mockResolvedValue([entry("second", 0), entry("first", 1)]);
  await store.refresh();
  expect(store.selectedStash?.index).toBe(1);
  await store.applyStash(store.selectedStash!.sha);
  expect(mocks.backend.stashApply).toHaveBeenCalledWith({
    path: "A",
    stashRef: "first",
    reinstateIndex: false,
  });
  mocks.backend.stashList.mockResolvedValue([entry("second", 0)]);
  await store.refresh();
  expect(store.selectedStashSha).toBeNull();
});
it("reports an empty stash without success feedback or an unhandled rejection", async () => {
  mocks.backend.stashCreate.mockRejectedValue({ code: "nothingToCommit" });
  const store = useStashShelfStore();
  expect(await store.createStash("empty")).toBe(false);
  expect(store.error).toBe("stash.noChanges");
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({ title: "stash.noChanges" });
  expect(store.busy).toBe(false);
});
it("blocks duplicate writes even after switching A to B to A", async () => {
  const pending = deferred();
  mocks.backend.stashCreate.mockReturnValue(pending.promise);
  const store = useStashShelfStore();
  const first = store.createStash("first");
  expect(store.busy).toBe(true);
  expect(await store.createStash("duplicate")).toBe(false);
  mocks.workspace.repoPath = "B";
  expect(store.busy).toBe(false);
  mocks.workspace.repoPath = "A";
  expect(store.busy).toBe(true);
  expect(await store.createStash("duplicate again")).toBe(false);
  pending.resolve();
  expect(await first).toBe(false);
  expect(mocks.backend.stashCreate).toHaveBeenCalledTimes(1);
  expect(mocks.backend.stashList).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(store.busy).toBe(false);
});
it("does not submit a stash dialog after its repository changed", async () => {
  const dialog = deferred();
  mocks.dialog.mockReturnValue(dialog.promise);
  const pending = useStashShelfStore().promptStash();
  mocks.workspace.repoPath = "B";
  mocks.workspace.repoPath = "A";
  dialog.resolve({ message: "old", includeUntracked: true, keepIndex: true });
  expect(await pending).toBe(false);
  expect(mocks.backend.stashCreate).not.toHaveBeenCalled();
});
it("keeps creation options and selected paths", async () => {
  mocks.dialog.mockResolvedValue({ message: "selected", includeUntracked: true, keepIndex: true });
  expect(await useStashShelfStore().promptStash({ paths: ["new.txt"] })).toBe(true);
  expect(mocks.backend.stashCreate).toHaveBeenCalledWith({
    path: "A",
    message: "selected",
    includeUntracked: true,
    keepIndex: true,
    paths: ["new.txt"],
  });
});
it("honors delete cancellation and invalidates a confirmation on repository change", async () => {
  const store = useStashShelfStore();
  mocks.confirm.mockResolvedValue(false);
  expect(await store.dropStash("first")).toBe(false);
  const confirm = deferred();
  mocks.confirm.mockReturnValue(confirm.promise);
  const pending = store.dropStash("first");
  mocks.workspace.repoPath = "B";
  confirm.resolve(true);
  expect(await pending).toBe(false);
  expect(mocks.backend.stashDrop).not.toHaveBeenCalled();
});

it("captures paths and blocks duplicate dialogs while awaiting creation options", async () => {
  const dialog = deferred();
  mocks.dialog.mockReturnValue(dialog.promise);
  const store = useStashShelfStore();
  const paths = ["first.txt"];
  const pending = store.promptStash({ paths });
  paths[0] = "later.txt";
  expect(store.busy).toBe(true);
  expect(await store.promptStash()).toBe(false);
  expect(await store.dropStash("first")).toBe(false);
  expect(mocks.dialog).toHaveBeenCalledTimes(1);
  expect(mocks.confirm).not.toHaveBeenCalled();
  dialog.resolve({ message: "saved", includeUntracked: false, keepIndex: false });
  expect(await pending).toBe(true);
  expect(mocks.backend.stashCreate).toHaveBeenCalledWith(
    expect.objectContaining({ paths: ["first.txt"] }),
  );
});

it("abandons a dialog as soon as navigation starts, before the visible repository changes", async () => {
  let navigation = 0;
  mocks.workspace.navigationToken = () => navigation;
  const dialog = deferred();
  mocks.dialog.mockReturnValue(dialog.promise);
  const pending = useStashShelfStore().promptStash();
  navigation++;
  dialog.resolve({ message: "old", includeUntracked: true, keepIndex: true });
  expect(await pending).toBe(false);
  expect(mocks.backend.stashCreate).not.toHaveBeenCalled();
});

it("refreshes partial changes and conflicts after failure, preserving the error", async () => {
  mocks.backend.stashApply.mockRejectedValue(new Error("index conflict"));
  const store = useStashShelfStore();
  expect(await store.applyStash("saved", true)).toBe(false);
  expect(mocks.backend.stashApply).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.conflicts).toHaveBeenCalledOnce();
  expect(mocks.opState).toHaveBeenCalledOnce();
  expect(mocks.backend.stashList).toHaveBeenCalledOnce();
  expect(store.error).toBe("index conflict");
  expect(store.busy).toBe(false);
});

it("suppresses late mutation feedback once navigation starts", async () => {
  let navigation = 0;
  mocks.workspace.navigationToken = () => navigation;
  const write = deferred();
  mocks.backend.stashPop.mockReturnValue(write.promise);
  const pending = useStashShelfStore().popStash("saved", true);
  navigation++;
  write.resolve();
  expect(await pending).toBe(false);
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("does not clear stashes that arrived while the confirmation was open", async () => {
  const store = useStashShelfStore();
  store.stashes = [entry("first", 0)];
  const confirmation = deferred();
  mocks.confirm.mockReturnValue(confirmation.promise);
  const pending = store.clearStashes();
  mocks.backend.stashList.mockResolvedValue([entry("new", 0), entry("first", 1)]);
  confirmation.resolve(true);
  expect(await pending).toBe(false);
  expect(mocks.backend.stashClear).not.toHaveBeenCalled();
  expect(store.error).toBe("stash.listChanged");
  expect(store.stashes).toHaveLength(2);
});

it("clears only after confirmation and a matching snapshot", async () => {
  const store = useStashShelfStore();
  store.stashes = [entry("first", 0)];
  mocks.backend.stashList.mockResolvedValue([entry("first", 0)]);
  mocks.confirm.mockResolvedValue(true);
  expect(await store.clearStashes()).toBe(true);
  expect(mocks.backend.stashClear).toHaveBeenCalledExactlyOnceWith({ path: "A" });
});
