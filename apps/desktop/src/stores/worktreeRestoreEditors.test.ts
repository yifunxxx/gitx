import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { useFileViewerStore } from "./fileViewerStore";
import { useRepoAtRevStore } from "./repoAtRevStore";
import { useFileOperationsStore } from "./fileOperationsStore";

const m = vi.hoisted(() => ({
  workspace: {} as any,
  layout: {} as any,
  conflicts: {} as any,
  fsReadFile: vi.fn(),
  diffFile: vi.fn(),
  fileWriteWorktree: vi.fn(),
  fsMutate: vi.fn(),
  treeList: vi.fn(),
  blobRead: vi.fn(),
  checkoutPathFromRev: vi.fn(),
  refresh: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => m.workspace }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => m.layout }));
vi.mock("./conflictsStore", () => ({ useConflictsStore: () => m.conflicts }));
vi.mock("./changesStore", () => ({ useChangesStore: () => ({ refresh: m.refresh }) }));
vi.mock("./fileTreeStore", () => ({ useFileTreeStore: () => ({ refreshExpanded: m.refresh }) }));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: m.confirm, promptDialog: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
const deferred = <T = any>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let pinia: Pinia;
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  m.workspace = reactive({
    repoPath: "C:/project",
    folderPath: "C:/project",
    repoId: "A",
    isRepo: true,
    roots: [],
    token: 1,
    navigationToken() {
      return this.token;
    },
    appliedOpenToken() {
      return this.token;
    },
  });
  m.layout = reactive({ activeEditorKind: "welcome" });
  m.conflicts = reactive({ busy: false, mergeTabs: [] });
  m.fsReadFile.mockResolvedValue("disk before");
  m.diffFile.mockResolvedValue({ rightText: "disk before", hunks: [] });
  m.treeList.mockResolvedValue([
    { path: "a.txt", name: "a.txt", kind: "blob", mode: "100644", sha: "blob", size: 3 },
  ]);
  m.blobRead.mockResolvedValue({ text: "old", binary: false, tooLarge: false });
  m.confirm.mockResolvedValue(true);
});
afterEach(() => disposePinia(pinia));
async function open() {
  const files = useFileViewerStore();
  await files.open("a.txt");
  const editor = files.tabs[0]!;
  const restore = useRepoAtRevStore();
  await restore.open("old");
  const revision = restore.tabs[0]!;
  await restore.openEntry(revision, revision.entries[0]!);
  return { files, editor, restore, revision };
}

it.each(["dirty", "loading", "saving", "file operation", "merge"])(
  "keeps the worktree and editor intact when restore meets %s work",
  async (kind) => {
    const { files, editor, restore, revision } = await open();
    if (kind === "dirty") files.setDocument(editor.id, "unsaved");
    if (kind === "loading") editor.loading = true;
    if (kind === "saving") editor.saving = true;
    if (kind === "file operation") files.fileMutationPending = true;
    if (kind === "merge") m.conflicts.mergeTabs = [{ path: "a.txt" }];
    expect(await restore.restoreFile(revision)).toBe(false);
    expect(m.checkoutPathFromRev).not.toHaveBeenCalled();
    expect(files.tabs).toContain(editor);
    expect(editor.editable).toBe(true);
    expect(revision.restoreError).toBeTruthy();
    if (kind === "file operation") expect(files.fileMutationPending).toBe(true);
  },
);

it("rechecks editor work started while restore confirmation was open", async () => {
  const { files, editor, restore, revision } = await open();
  const answer = deferred<boolean>();
  m.confirm.mockReturnValueOnce(answer.promise);
  const work = restore.restoreFile(revision);
  files.setDocument(editor.id, "new draft during confirmation");
  answer.resolve(true);
  expect(await work).toBe(false);
  expect(m.checkoutPathFromRev).not.toHaveBeenCalled();
  expect(editor.text).toBe("new draft during confirmation");
  expect(editor.dirty).toBe(true);
});

it("locks saves, new editors and file mutations until restore settles, then closes only stale content", async () => {
  const { files, editor, restore, revision } = await open();
  const pending = deferred();
  m.checkoutPathFromRev.mockReturnValueOnce(pending.promise);
  const work = restore.restoreFile(revision);
  await flushPromises();
  expect(files.fileMutationPending).toBe(true);
  expect(editor.restorePending).toBe(true);
  files.setDocument(editor.id, "typing during restore");
  expect(editor.text).toBe("disk before");
  expect(await files.save(editor.id)).toBe(false);
  await files.open("b.txt");
  expect(files.tabs).toHaveLength(1);
  await useFileOperationsStore().run("move", ["a.txt"], "destination");
  expect(m.fsMutate).not.toHaveBeenCalled();
  pending.resolve(null);
  expect(await work).toBe(true);
  expect(files.tabs).toHaveLength(0);
  expect(files.fileMutationPending).toBe(false);
  expect(m.layout.activeEditorKind).toBe("repoAtRev");
  m.fsReadFile.mockResolvedValueOnce("restored disk");
  await files.open("a.txt");
  expect(files.tabs[0]?.text).toBe("restored disk");
});

it("retains editor text and restores editing after a rejected write, allowing a retry", async () => {
  const { files, editor, restore, revision } = await open();
  m.checkoutPathFromRev.mockRejectedValueOnce(new Error("index locked"));
  expect(await restore.restoreFile(revision)).toBe(false);
  expect(files.tabs).toContain(editor);
  expect(editor).toMatchObject({ text: "disk before", editable: true, dirty: false });
  expect(files.fileMutationPending).toBe(false);
  expect(revision.restoreError).toContain("index locked");
  expect(await restore.restoreFile(revision)).toBe(true);
  expect(files.tabs).not.toContain(editor);
});

it("keeps an unrelated dirty editor and the active history view", async () => {
  const { files, editor, restore, revision } = await open();
  await files.open("other.txt");
  const other = files.tabs[1]!;
  files.setDocument(other.id, "keep draft");
  m.layout.activeEditorKind = "repoAtRev";
  expect(await restore.restoreFile(revision)).toBe(true);
  expect(files.tabs).not.toContain(editor);
  expect(files.tabs).toContain(other);
  expect(other).toMatchObject({ text: "keep draft", dirty: true, editable: true });
  expect(m.layout.activeEditorKind).toBe("repoAtRev");
});

it("rechecks a shared write acquired while confirmation was pending without unlocking it", async () => {
  const { files, restore, revision } = await open();
  const answer = deferred<boolean>();
  m.confirm.mockReturnValueOnce(answer.promise);
  const work = restore.restoreFile(revision);
  files.fileMutationPending = true;
  answer.resolve(true);
  expect(await work).toBe(false);
  expect(m.checkoutPathFromRev).not.toHaveBeenCalled();
  expect(files.fileMutationPending).toBe(true);
});

it.each([false, true])(
  "does not alter replacement tabs after navigation (failure=%s)",
  async (failure) => {
    const { files, editor, restore, revision } = await open();
    const pending = deferred();
    m.checkoutPathFromRev.mockReturnValueOnce(pending.promise);
    const work = restore.restoreFile(revision);
    await flushPromises();
    m.workspace.repoPath = "C:/other";
    m.workspace.folderPath = "C:/other";
    m.workspace.token++;
    const replacement = {
      ...editor,
      id: "other",
      text: "replacement",
      restorePending: false,
      fileOperationPending: false,
    };
    files.tabs.push(replacement);
    if (failure) pending.reject(new Error("old write failed"));
    else pending.resolve(null);
    await work;
    expect(files.tabs).toHaveLength(1);
    expect(files.tabs[0]?.text).toBe("replacement");
    expect(files.fileMutationPending).toBe(false);
    expect(m.refresh).not.toHaveBeenCalled();
  },
);

it("protects a file opened from a parent folder using its actual repository path", async () => {
  const { files, editor, restore, revision } = await open();
  files.closeTab(editor.id);
  files.tabs.push({
    ...editor,
    id: "parent",
    folderPath: "C:/",
    path: "project/a.txt",
    dirty: true,
  });
  m.layout.activeEditorKind = "repoAtRev";
  expect(await restore.restoreFile(revision)).toBe(false);
  expect(m.checkoutPathFromRev).not.toHaveBeenCalled();
});
