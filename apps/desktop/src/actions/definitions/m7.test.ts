import { beforeEach, expect, it, vi } from "vitest";
import { registerM7Actions } from "./m7";
import { runAction } from "../registry";
import type { ActionContext } from "../types";

const mocks = vi.hoisted(() => ({
  workspace: { repoPath: "A", folderPath: "A", isRepo: true, navigationToken: (): number => 1 },
  settings: { settings: { git: { forkParentRemote: "upstream" } } },
  confirm: vi.fn(),
  syncFork: vi.fn(),
  submoduleUpdate: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: mocks.confirm }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({ syncFork: mocks.syncFork, submoduleUpdate: mocks.submoduleUpdate }),
}));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: mocks.refresh }) }));
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
  mocks.syncFork.mockResolvedValue({ message: "done" });
  mocks.submoduleUpdate.mockResolvedValue({ items: [], message: "done" });
  registerM7Actions();
});

it("does not fetch, merge or push after cancellation", async () => {
  mocks.confirm.mockResolvedValue(false);
  await runAction("Github.Sync.Fork", context);
  expect(mocks.syncFork).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("invalidates a confirmation after A to B to A navigation", async () => {
  const pending = deferred<boolean>();
  mocks.confirm.mockReturnValue(pending.promise);
  const running = runAction("Github.Sync.Fork", context);
  mocks.workspace.navigationToken = () => 2;
  pending.resolve(true);
  await running;
  expect(mocks.syncFork).not.toHaveBeenCalled();
});

it("only performs the explicitly confirmed sync and push, blocking duplicate requests", async () => {
  const pending = deferred<{ message: string }>();
  mocks.confirm.mockResolvedValue(true);
  mocks.syncFork.mockReturnValue(pending.promise);
  const running = runAction("Github.Sync.Fork", context);
  await Promise.resolve();
  const duplicate = runAction("Github.Sync.Fork", context);
  await Promise.resolve();
  try {
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.syncFork).toHaveBeenCalledExactlyOnceWith({
      path: "A",
      parentRemote: "upstream",
      strategy: null,
      pushOrigin: true,
    });
    mocks.workspace.repoPath = "B";
  } finally {
    pending.resolve({ message: "done" });
    await Promise.all([running, duplicate]);
  }
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("releases the busy guard after failure so the user can retry", async () => {
  mocks.confirm.mockResolvedValue(true);
  mocks.syncFork.mockRejectedValueOnce(new Error("offline"));
  await runAction("Github.Sync.Fork", context);
  expect(mocks.toast).toHaveBeenCalledWith({
    title: "actions.syncForkFailed",
    description: "offline",
    persistent: true,
  });
  await runAction("Github.Sync.Fork", context);
  expect(mocks.syncFork).toHaveBeenCalledTimes(2);
});

it("reports submodule failures with details and persistent feedback", async () => {
  mocks.submoduleUpdate.mockResolvedValue({
    items: [
      {
        path: "libs/a",
        updated: false,
        skipped: false,
        message: "local changes would be overwritten",
      },
    ],
    message: "0 updated",
  });
  await runAction("Git.Submodule.Update", context);
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "syncUi.submodulesFailed",
      persistent: true,
      description: expect.stringContaining("libs/a: local changes would be overwritten"),
    }),
  );
});

it("blocks duplicate submodule updates and discards late feedback after A to B to A", async () => {
  const pending = deferred<{ items: []; message: string }>();
  mocks.submoduleUpdate.mockReturnValue(pending.promise);
  const running = runAction("Git.Submodule.Update", context);
  await runAction("Git.Submodule.Update", context);
  expect(mocks.submoduleUpdate).toHaveBeenCalledOnce();
  mocks.workspace.navigationToken = () => 2;
  pending.resolve({ items: [], message: "done" });
  await running;
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("submodule update errors release busy state and permit retry", async () => {
  mocks.submoduleUpdate.mockRejectedValueOnce(new Error("invalid config"));
  await runAction("Git.Submodule.Update", context);
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "syncUi.submodulesFailed",
      description: "invalid config",
      persistent: true,
    }),
  );
  await runAction("Git.Submodule.Update", context);
  expect(mocks.submoduleUpdate).toHaveBeenCalledTimes(2);
});
