import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { flushPromises } from "@vue/test-utils";
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
    shelfUnshelve: vi.fn(),
    shelfDelete: vi.fn(),
    shelfRename: vi.fn(),
    shelfImport: vi.fn(),
  },
  refresh: vi.fn(),
  conflicts: vi.fn(),
  opState: vi.fn(),
  toast: vi.fn(),
  dialog: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
  isTauri: vi.fn(),
  fileOpen: vi.fn(),
}));
vi.mock("@/lib/utils", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.fileOpen }));
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

it("keeps the shelf by default and refreshes all views after a successful apply", async () => {
  mocks.backend.shelfUnshelve.mockResolvedValue({ applied: ["saved.txt"], failed: [] });
  const store = useStashShelfStore();
  expect(await store.unshelve("shelf-id")).toBe(true);
  expect(mocks.backend.shelfUnshelve).toHaveBeenCalledExactlyOnceWith({
    path: "A",
    id: "shelf-id",
    removeApplied: false,
  });
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.conflicts).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({ title: "shelf.unshelved" });
});

it("reports failed unshelve, refreshes conflicts and releases the write guard", async () => {
  mocks.backend.shelfUnshelve.mockRejectedValue(new Error("local changes would be overwritten"));
  const store = useStashShelfStore();
  expect(await store.unshelve("shelf-id", true)).toBe(false);
  expect(mocks.backend.shelfUnshelve).toHaveBeenCalledExactlyOnceWith({
    path: "A",
    id: "shelf-id",
    removeApplied: true,
  });
  expect(mocks.conflicts).toHaveBeenCalledOnce();
  expect(mocks.opState).toHaveBeenCalledOnce();
  expect(store.error).toBe("local changes would be overwritten");
  expect(store.busy).toBe(false);
});

it("blocks duplicate unshelve and suppresses feedback after navigation", async () => {
  const pending = deferred();
  mocks.backend.shelfUnshelve.mockReturnValue(pending.promise);
  const store = useStashShelfStore();
  const first = store.unshelve("shelf-id");
  expect(await store.unshelve("shelf-id")).toBe(false);
  mocks.workspace.repoPath = "B";
  pending.resolve({ applied: ["saved.txt"], failed: [] });
  expect(await first).toBe(false);
  expect(mocks.backend.shelfUnshelve).toHaveBeenCalledOnce();
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("does not announce success if an older backend returns failed paths", async () => {
  mocks.backend.shelfUnshelve.mockResolvedValue({ applied: [], failed: ["conflict.txt"] });
  const store = useStashShelfStore();
  expect(await store.unshelve("shelf-id")).toBe(false);
  expect(store.error).toBe("shelf.applyFailed");
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({ title: "shelf.applyFailed" });
});

it("captures Shelf paths and blocks all overlapping dialogs until creation completes", async () => {
  const dialog = deferred();
  mocks.dialog.mockReturnValue(dialog.promise);
  const store = useStashShelfStore();
  const paths = ["first.txt"];
  const pending = store.promptShelf(paths);
  paths[0] = "later.txt";
  expect(store.busy).toBe(true);
  expect(await store.promptShelf(paths)).toBe(false);
  expect(await store.deleteShelf("saved")).toBe(false);
  expect(await store.promptStash()).toBe(false);
  expect(mocks.dialog).toHaveBeenCalledOnce();
  expect(mocks.confirm).not.toHaveBeenCalled();
  dialog.resolve({ message: " selected ", keepChanges: true });
  expect(await pending).toBe(true);
  expect(mocks.backend.shelfCreate).toHaveBeenCalledExactlyOnceWith({
    path: "A",
    message: "selected",
    keepChanges: true,
    paths: ["first.txt"],
    sourceChangelist: null,
  });
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({ title: "shelf.created" });
});

it("invalidates Shelf creation when navigation begins, including A to B to A", async () => {
  for (const switchPath of [false, true]) {
    let navigation = 0;
    mocks.workspace.navigationToken = () => navigation;
    const dialog = deferred();
    mocks.dialog.mockReturnValue(dialog.promise);
    const pending = useStashShelfStore().promptShelf(["first.txt"]);
    if (switchPath) {
      mocks.workspace.repoPath = "B";
      mocks.workspace.repoPath = "A";
    } else navigation++;
    dialog.resolve({ message: "old", keepChanges: false });
    expect(await pending).toBe(false);
  }
  expect(mocks.backend.shelfCreate).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("refreshes a saved Shelf after cleanup fails and presents empty creation separately", async () => {
  mocks.dialog.mockResolvedValue({ message: "new", keepChanges: false });
  mocks.backend.shelfCreate.mockRejectedValue(new Error("Shelf saved but cleanup failed"));
  const store = useStashShelfStore();
  expect(await store.promptShelf(["first.txt"])).toBe(false);
  expect(store.error).toBe("Shelf saved but cleanup failed");
  expect(mocks.backend.shelfList).toHaveBeenCalledOnce();
  expect(mocks.refresh).toHaveBeenCalledOnce();
  mocks.backend.shelfCreate.mockRejectedValue({ code: "nothingToCommit" });
  expect(await store.promptShelf(["first.txt"])).toBe(false);
  expect(store.error).toBe("shelf.noChangesToSave");
  expect(store.busy).toBe(false);
});

it("cancels creation without writes and releases the dialog guard", async () => {
  mocks.dialog.mockResolvedValue(null);
  const store = useStashShelfStore();
  expect(await store.promptShelf([])).toBe(false);
  expect(mocks.dialog).not.toHaveBeenCalled();
  expect(await store.promptShelf(["first.txt"])).toBe(false);
  expect(mocks.backend.shelfCreate).not.toHaveBeenCalled();
  expect(store.busy).toBe(false);
});

it("holds the Shelf deletion guard through confirmation and rejects stale navigation", async () => {
  const store = useStashShelfStore();
  const confirmation = deferred();
  mocks.confirm.mockReturnValue(confirmation.promise);
  const pending = store.deleteShelf("original");
  expect(await store.deleteShelf("other")).toBe(false);
  expect(mocks.confirm).toHaveBeenCalledOnce();
  let navigation = 0;
  mocks.workspace.navigationToken = () => navigation;
  navigation++;
  confirmation.resolve(true);
  expect(await pending).toBe(false);
  expect(mocks.backend.shelfDelete).not.toHaveBeenCalled();
  mocks.confirm.mockResolvedValue(false);
  expect(await store.deleteShelf("original")).toBe(false);
  mocks.confirm.mockResolvedValue(true);
  expect(await store.deleteShelf("original")).toBe(true);
  expect(mocks.backend.shelfDelete).toHaveBeenCalledExactlyOnceWith({ path: "A", id: "original" });
});

it("renames the captured Shelf despite selection changes and rejects stale prompts", async () => {
  const store = useStashShelfStore();
  store.shelves = [
    { id: "original", message: "old" },
    { id: "other", message: "other" },
  ] as any;
  const prompt = deferred();
  mocks.prompt.mockReturnValue(prompt.promise);
  const pending = store.promptRenameShelf("original");
  store.selectedShelfId = "other";
  expect(await store.promptRenameShelf("other")).toBe(false);
  expect(mocks.prompt).toHaveBeenCalledOnce();
  prompt.resolve("  renamed  ");
  expect(await pending).toBe(true);
  expect(mocks.backend.shelfRename).toHaveBeenCalledExactlyOnceWith({
    path: "A",
    id: "original",
    message: "renamed",
  });
  store.shelves = [{ id: "original", message: "old" }] as any;
  const stale = deferred();
  mocks.prompt.mockReturnValue(stale.promise);
  const next = store.promptRenameShelf("original");
  mocks.workspace.repoPath = "B";
  stale.resolve("stale");
  expect(await next).toBe(false);
  expect(mocks.backend.shelfRename).toHaveBeenCalledOnce();
});

it("holds the import guard across the file picker and selects the imported Shelf", async () => {
  mocks.isTauri.mockReturnValue(true);
  const picker = deferred();
  mocks.fileOpen.mockReturnValue(picker.promise);
  mocks.backend.shelfImport.mockResolvedValue({ id: "imported" });
  mocks.backend.shelfList.mockResolvedValue([{ id: "imported", paths: ["a.txt"] }]);
  const store = useStashShelfStore();
  const pending = store.promptImportShelf();
  expect(store.busy).toBe(true);
  expect(await store.promptImportShelf()).toBe(false);
  expect(await store.promptStash()).toBe(false);
  await flushPromises();
  expect(mocks.fileOpen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    directory: false, multiple: false,
    filters: [{ name: "shelf.patchFiles", extensions: ["patch", "diff"] }],
  }));
  picker.resolve("C:\\补丁 文件\\feature.PATCH");
  expect(await pending).toBe(true);
  expect(mocks.backend.shelfImport).toHaveBeenCalledExactlyOnceWith({
    path: "A", patchFile: "C:\\补丁 文件\\feature.PATCH", message: "feature",
  });
  expect(store.selectedShelfId).toBe("imported");
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({ title: "shelf.imported" });
  expect(store.busy).toBe(false);
});

it("abandons native import after navigation or A to B to A while the picker is open", async () => {
  mocks.isTauri.mockReturnValue(true);
  for (const switchPath of [false, true]) {
    let navigation = 0;
    mocks.workspace.navigationToken = () => navigation;
    const picker = deferred();
    mocks.fileOpen.mockReturnValue(picker.promise);
    const pending = useStashShelfStore().promptImportShelf();
    await flushPromises();
    if (switchPath) {
      mocks.workspace.repoPath = "B";
      mocks.workspace.repoPath = "A";
    } else navigation++;
    picker.resolve("/tmp/old.patch");
    expect(await pending).toBe(false);
  }
  expect(mocks.backend.shelfImport).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("handles picker cancellation and failures without leaving a pending write", async () => {
  mocks.isTauri.mockReturnValue(true);
  const store = useStashShelfStore();
  mocks.fileOpen.mockResolvedValue(null);
  expect(await store.promptImportShelf()).toBe(false);
  expect(mocks.backend.shelfImport).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
  mocks.fileOpen.mockRejectedValue(new Error("picker unavailable"));
  expect(await store.promptImportShelf()).toBe(false);
  expect(store.error).toBe("picker unavailable");
  expect(store.busy).toBe(false);
});

it("keeps import errors visible and does not select a late result in another repository", async () => {
  mocks.prompt.mockResolvedValue("/tmp/feature.diff");
  mocks.backend.shelfImport.mockRejectedValue({ code: "nothingToCommit" });
  const store = useStashShelfStore();
  expect(await store.promptImportShelf()).toBe(false);
  expect(store.error).toBe("shelf.noPatchChanges");
  expect(store.selectedShelfId).toBeNull();
  const write = deferred();
  mocks.backend.shelfImport.mockReturnValue(write.promise);
  const pending = store.promptImportShelf();
  await flushPromises();
  mocks.workspace.repoPath = "B";
  const notifications = mocks.toast.mock.calls.length;
  write.resolve({ id: "old-result" });
  expect(await pending).toBe(false);
  expect(store.selectedShelfId).toBeNull();
  expect(mocks.toast).toHaveBeenCalledTimes(notifications);
  expect(store.busy).toBe(false);
});
