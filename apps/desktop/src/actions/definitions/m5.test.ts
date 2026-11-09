import { beforeEach, expect, it, vi } from "vitest";
import { registerM5Actions } from "./m5";
import { runAction } from "../registry";
import type { ActionContext } from "../types";

const mocks = vi.hoisted(() => ({
  workspace: { repoPath: "A", isRepo: true, navigationToken: (): number => 1 },
  rewrite: {
    busy: false,
    canUndo: false,
    undoWithFeedback: vi.fn(),
    repositoryToken: (): number => 1,
    drop: vi.fn(),
    fixupInto: vi.fn(),
    extractChanges: vi.fn(),
    dropChanges: vi.fn(),
  },
  log: { selectedSha: "commit-a", selectedShas: ["commit-a"], changedFiles: [{ path: "a.txt" }] },
  open: vi.fn(),
  prompt: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => mocks.log }));
vi.mock("@/composables/useConfirm", () => ({
  promptDialog: mocks.prompt,
  confirmDialog: mocks.confirm,
}));
vi.mock("@/composables/useDialog", () => ({ openDialog: mocks.open }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
const context: ActionContext = {
  folderPath: "A",
  repoIds: ["A"],
  selection: {},
  source: "palette",
  place: "test",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace.repoPath = "A";
  mocks.workspace.navigationToken = () => 1;
  mocks.rewrite.repositoryToken = () => 1;
  mocks.rewrite.busy = false;
  mocks.rewrite.canUndo = false;
  mocks.log.selectedSha = "commit-a";
  mocks.log.selectedShas = ["commit-a"];
  mocks.log.changedFiles = [{ path: "a.txt" }];
  registerM5Actions();
});

it("only enables the persistent undo action when a guarded backup is available", async () => {
  await runAction("Git.Undo.Rewrite", context);
  expect(mocks.rewrite.undoWithFeedback).not.toHaveBeenCalled();
  mocks.rewrite.canUndo = true;
  await runAction("Git.Undo.Rewrite", context);
  expect(mocks.rewrite.undoWithFeedback).toHaveBeenCalledOnce();
  mocks.rewrite.busy = true;
  await runAction("Git.Undo.Rewrite", context);
  expect(mocks.rewrite.undoWithFeedback).toHaveBeenCalledOnce();
});

it.each([
  ["Git.InMemory.Extract.Selected.Changes", "extract"],
  ["Git.Drop.Selected.Changes", "drop"],
])("%s opens file selection for the captured commit", async (id, mode) => {
  const pending = deferred<unknown>();
  mocks.open.mockReturnValue(pending.promise);
  mocks.log.changedFiles = [];
  const result = runAction(id, context);
  mocks.log.selectedSha = "commit-b";
  expect(mocks.open).toHaveBeenCalledWith(expect.anything(), { commit: "commit-a", mode });
  pending.resolve(null);
  await result;
  expect(mocks.rewrite.extractChanges).not.toHaveBeenCalled();
  expect(mocks.rewrite.dropChanges).not.toHaveBeenCalled();
  expect(mocks.prompt).not.toHaveBeenCalled();
});

it.each([
  ["Git.Drop.Commits", "confirm", "drop", true],
  ["Git.Squash.Into.Commit", "prompt", "fixupInto", "message"],
] as const)("%s never writes after repository navigation", async (id, dialog, operation, value) => {
  const pending = deferred<typeof value>();
  mocks[dialog].mockReturnValue(pending.promise);
  const result = runAction(id, context);
  // Also cover A -> B -> A and a navigation that has started but not loaded.
  mocks.workspace.navigationToken = () => 2;
  pending.resolve(value);
  await result;
  expect(mocks.rewrite[operation]).not.toHaveBeenCalled();
});

it("disables writes and prompts while another rewrite is running", async () => {
  mocks.rewrite.busy = true;
  await runAction("Git.Drop.Commits", context);
  await runAction("Git.Fixup.To.Commit", context);
  await runAction("Git.InMemory.Extract.Selected.Changes", context);
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(mocks.rewrite.fixupInto).not.toHaveBeenCalled();
});
