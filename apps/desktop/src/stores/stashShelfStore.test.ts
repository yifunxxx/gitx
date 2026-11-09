import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useStashShelfStore } from "./stashShelfStore";

const mocks = vi.hoisted(() => ({
  workspace: { repoPath: "A", isRepo: true },
  backend: {
    stashList: vi.fn(),
    shelfList: vi.fn(),
    shelfCreate: vi.fn(),
    stashCreate: vi.fn(),
    stashApply: vi.fn(),
    stashDrop: vi.fn(),
  },
  refresh: vi.fn(),
  toast: vi.fn(),
  dialog: vi.fn(),
  confirm: vi.fn(),
  prompt: vi.fn(),
}));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./settingsStore", () => ({ useSettingsStore: () => ({}) }));
vi.mock("./changesStore", () => ({ useChangesStore: () => ({ refresh: mocks.refresh }) }));
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
  mocks.workspace = reactive({ repoPath: "A", isRepo: true });
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

it("captures shelf paths before prompting and abandons a prompt after repository changes", async () => {
  const prompt = deferred();
  mocks.prompt.mockReturnValue(prompt.promise);
  const store = useStashShelfStore();
  const paths = ["first.txt"];
  const pending = store.promptShelf(paths);
  paths[0] = "later.txt";
  prompt.resolve("saved");
  expect(await pending).toBe(true);
  expect(mocks.backend.shelfCreate).toHaveBeenCalledWith({
    path: "A",
    message: "saved",
    paths: ["first.txt"],
    sourceChangelist: null,
  });
  const other = deferred();
  mocks.prompt.mockReturnValue(other.promise);
  const stale = store.promptShelf(paths);
  mocks.workspace.repoPath = "B";
  other.resolve("old");
  expect(await stale).toBe(false);
  expect(mocks.backend.shelfCreate).toHaveBeenCalledTimes(1);
});
