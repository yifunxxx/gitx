import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import { registerVcsActions } from "./vcs";
import { getAction, isEnabled, runAction } from "../registry";
import type { ActionContext } from "../types";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useWorkspaceOpen } from "@/composables/useWorkspaceOpen";
import { i18n } from "@/i18n";

const m = vi.hoisted(() => ({
  pick: vi.fn(),
  workspaceOpen: vi.fn(),
  workspaceRecent: vi.fn(),
  initRun: vi.fn(),
  vcsEnable: vi.fn(),
  appOpenNewWindow: vi.fn(),
  refresh: vi.fn(),
  load: vi.fn(),
  branches: vi.fn(),
  toast: vi.fn(),
  choose: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: m.refresh }) }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => ({ load: m.load }) }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({ refresh: m.branches }) }));
vi.mock("@/lib/utils", async (original) => ({
  ...(await original<object>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: m.pick }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/composables/useOpenProjectChoice", () => ({
  chooseOpenProjectTarget: m.choose,
}));

enableAutoUnmount(afterEach);
const cleanup: Array<() => void> = [];
const running: Promise<unknown>[] = [];
function track<T>(promise: Promise<T>) {
  running.push(promise);
  void promise.catch(() => {});
  return promise;
}
afterEach(async () => {
  for (const release of cleanup.splice(0)) release();
  await Promise.allSettled(running.splice(0));
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  cleanup.push(() => resolve(undefined as T));
  return { promise, resolve, reject };
}
const result = (path: string, isRepo = true) => ({
  path,
  isRepo,
  gitDir: isRepo ? `${path}/.git` : null,
  toplevel: isRepo ? path : null,
});
const context = (): ActionContext => ({
  repoIds: [],
  selection: {},
  source: "shortcut",
  place: "global",
  folderPath: useWorkspaceStore().folderPath,
});
const run = (id = "File.OpenFolder") => track(runAction(id, context()));
function componentEntry() {
  let entry!: ReturnType<typeof useWorkspaceOpen>;
  mount(
    defineComponent({
      setup() {
        entry = useWorkspaceOpen();
        return () => null;
      },
    }),
    { global: { plugins: [i18n] } },
  );
  return entry;
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  setActivePinia(createPinia());
  m.workspaceOpen.mockImplementation(async ({ path }) => result(path));
  m.initRun.mockImplementation(async ({ path }) => result(path));
  m.vcsEnable.mockImplementation(async ({ path }) => result(path));
  m.workspaceRecent.mockResolvedValue({ paths: [] });
  m.appOpenNewWindow.mockResolvedValue(null);
  m.choose.mockResolvedValue("here");
  const layout = useLayoutStore();
  layout.leftOpen = false;
  layout.bottomOpen = false;
  layout.activeBottomTab = "console";
  registerVcsActions();
});

it("blocks action pickers while the component entry owns the picker", async () => {
  const picker = deferred<string | null>();
  m.pick.mockReturnValue(picker.promise);
  const entry = componentEntry();
  const opening = track(entry.openFolder());
  const duplicate = run();
  const creating = run("Git.Init");
  await flushPromises();
  expect(m.pick).toHaveBeenCalledOnce();
  expect(isEnabled(getAction("File.OpenFolder")!, context())).toBe(false);
  expect(isEnabled(getAction("Git.Init")!, context())).toBe(false);
  picker.resolve(null);
  await Promise.all([opening, duplicate, creating]);
});

it("shares action progress and suppresses component and action re-entry", async () => {
  const picker = deferred<string | null>();
  m.pick.mockReturnValue(picker.promise);
  const entry = componentEntry();
  const opening = run();
  expect(entry.pending.value).toBe(true);
  const componentDuplicate = track(entry.openRecent("other"));
  const duplicate = run();
  await flushPromises();
  expect(m.pick).toHaveBeenCalledOnce();
  expect(m.workspaceOpen).not.toHaveBeenCalled();
  picker.resolve(null);
  await Promise.all([opening, componentDuplicate, duplicate]);
  expect(entry.pending.value).toBe(false);
  expect(isEnabled(getAction("File.OpenFolder")!, context())).toBe(true);
});

it.each(["File.OpenFolder", "Git.Init"])(
  "%s discards a picker selection after another navigation",
  async (id) => {
    const picker = deferred<string | null>();
    m.pick.mockReturnValue(picker.promise);
    const opening = run(id);
    await flushPromises();
    await useWorkspaceStore().openFolder("newer");
    picker.resolve("obsolete");
    await opening;
    expect(useWorkspaceStore().folderPath).toBe("newer");
    expect(m.workspaceOpen).toHaveBeenCalledExactlyOnceWith({ path: "newer" });
    expect(m.initRun).not.toHaveBeenCalled();
    expect(m.toast).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  },
);

it.each(["File.OpenFolder", "Git.Init"])(
  "%s ignores stale completion instead of refreshing or changing the new workspace",
  async (id) => {
    const old = deferred<ReturnType<typeof result>>();
    m.pick.mockResolvedValue("old");
    (id === "Git.Init" ? m.initRun : m.workspaceOpen).mockReturnValueOnce(old.promise);
    const opening = run(id);
    await flushPromises();
    await useWorkspaceStore().openFolder("newer");
    old.resolve(result("old"));
    await opening;
    expect(useWorkspaceStore().folderPath).toBe("newer");
    expect(m.toast).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.load).not.toHaveBeenCalled();
    expect(useLayoutStore().activeBottomTab).toBe("console");
  },
);

it("keeps initialization busy until independent initial reads finish", async () => {
  const reading = deferred<void>();
  m.pick.mockResolvedValue("new repo");
  m.refresh.mockReturnValue(reading.promise);
  const entry = componentEntry();
  const creating = run("Git.Init");
  await flushPromises();
  expect(entry.pending.value).toBe(true);
  expect(entry.pendingPath.value).toBe("new repo");
  expect(m.refresh).toHaveBeenCalledOnce();
  expect(m.load).toHaveBeenCalledExactlyOnceWith(true, false, { taskOwned: true });
  expect(m.branches).toHaveBeenCalledOnce();
  await run("Git.Init");
  expect(m.initRun).toHaveBeenCalledExactlyOnceWith({ path: "new repo", initialBranch: "main" });
  reading.resolve();
  await creating;
  expect(entry.pending.value).toBe(false);
});

it.each(["File.OpenFolder", "Git.Init"])(
  "%s still initializes the opened repository when recent projects cannot refresh",
  async (id) => {
    const reading = deferred<void>();
    m.pick.mockResolvedValue("opened repo");
    m.workspaceRecent.mockRejectedValueOnce(new Error("Recent projects unavailable"));
    m.refresh.mockReturnValue(reading.promise);
    const workspace = useWorkspaceStore();
    workspace.recent = ["previous repo"];
    const entry = componentEntry();
    const opening = run(id);
    await flushPromises();
    expect(workspace.folderPath).toBe("opened repo");
    expect(workspace.recent).toEqual(["previous repo"]);
    expect(m.refresh).toHaveBeenCalledOnce();
    expect(m.load).toHaveBeenCalledExactlyOnceWith(true, false, { taskOwned: true });
    expect(m.branches).toHaveBeenCalledOnce();
    expect(useLayoutStore().leftOpen).toBe(true);
    expect(useLayoutStore().bottomOpen).toBe(true);
    expect(useLayoutStore().activeBottomTab).toBe("log");
    expect(entry.pending.value).toBe(true);
    expect(entry.error.value).toBeNull();
    expect(m.toast).toHaveBeenCalledWith({
      title: i18n.global.t("welcome.recentRefreshFailed"),
      description: "Recent projects unavailable",
    });
    expect(m.toast).toHaveBeenCalledWith({
      title: i18n.global.t(id === "Git.Init" ? "welcome.repoCreated" : "welcome.opened"),
      description: "opened repo",
    });
    reading.resolve();
    await opening;
    expect(entry.pending.value).toBe(false);
  },
);

it("reports a readable action failure in the shared welcome state and permits retry", async () => {
  m.pick.mockResolvedValue("missing");
  m.workspaceOpen.mockRejectedValueOnce({ message: "Directory is unavailable" });
  const entry = componentEntry();
  await expect(run()).resolves.toBeUndefined();
  expect(entry.error.value).toBe("Directory is unavailable");
  expect(entry.pending.value).toBe(false);
  await run();
  expect(entry.error.value).toBeNull();
  expect(useWorkspaceStore().folderPath).toBe("missing");
});

it.each(["folder", "create", "recent", "clone"] as const)(
  "%s starts and completes primary reads while the recent-project list is still pending",
  async (kind) => {
    const recent = deferred<{ paths: string[] }>();
    const files = deferred<void>();
    m.workspaceRecent.mockReturnValueOnce(recent.promise);
    m.refresh.mockReturnValueOnce(files.promise);
    m.pick.mockResolvedValue("opened repo");
    const workspace = useWorkspaceStore();
    workspace.recent = ["previous repo"];
    const entry = componentEntry();
    const opening = track(
      kind === "folder" ? entry.openFolder()
        : kind === "create" ? entry.createRepo()
          : kind === "recent" ? entry.openRecent("opened repo")
            : entry.openCloned("opened repo"),
    );
    let finished = false;
    void opening.then(() => { finished = true; });
    await flushPromises();
    expect(workspace.repoPath).toBe("opened repo");
    expect(workspace.recent).toEqual(["previous repo"]);
    expect(m.refresh).toHaveBeenCalledOnce();
    expect(m.load).toHaveBeenCalledExactlyOnceWith(true, false, { taskOwned: true });
    expect(m.branches).toHaveBeenCalledOnce();
    expect(useLayoutStore().activeBottomTab).toBe("log");
    expect(entry.pending.value).toBe(true);
    files.resolve();
    await flushPromises();
    expect(finished).toBe(true);
    expect(entry.pending.value).toBe(false);
    expect(isEnabled(getAction("File.OpenFolder")!, context())).toBe(true);
    recent.resolve({ paths: ["opened repo", "previous repo"] });
    await opening;
    await flushPromises();
    expect(workspace.recent).toEqual(["opened repo", "previous repo"]);
    expect(m.refresh).toHaveBeenCalledOnce();
  },
);

it("prevents duplicate enable-VCS requests and blocks other entry points", async () => {
  const enabling = deferred<ReturnType<typeof result>>();
  useWorkspaceStore().folderPath = "folder";
  m.vcsEnable.mockReturnValue(enabling.promise);
  const entry = componentEntry();
  const first = run("Start.Use.Vcs");
  const second = run("Start.Use.Vcs");
  const opening = run();
  await flushPromises();
  expect(m.vcsEnable).toHaveBeenCalledExactlyOnceWith({ path: "folder", initialBranch: "main" });
  expect(m.pick).not.toHaveBeenCalled();
  expect(entry.pending.value).toBe(true);
  expect(entry.pendingPath.value).toBe("folder");
  enabling.resolve(result("folder"));
  await Promise.all([first, second, opening]);
  expect(entry.pending.value).toBe(false);
});

it.each(["success", "failure"] as const)(
  "ignores late recent-list %s after a second project opens",
  async (outcome) => {
    const old = deferred<{ paths: string[] }>();
    m.workspaceRecent.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ paths: ["B", "A"] });
    const entry = componentEntry();
    let firstFinished = false;
    const first = track(entry.openRecent("A").then(() => { firstFinished = true; }));
    await flushPromises();
    expect(firstFinished).toBe(true);
    await track(entry.openRecent("B"));
    expect(useWorkspaceStore().repoPath).toBe("B");
    expect(useWorkspaceStore().recent).toEqual(["B", "A"]);
    const reads = m.refresh.mock.calls.length;
    if (outcome === "success") old.resolve({ paths: ["A"] });
    else old.reject(new Error("Old recent-list failure"));
    await first;
    await flushPromises();
    expect(useWorkspaceStore().recent).toEqual(["B", "A"]);
    expect(useWorkspaceStore().repoPath).toBe("B");
    expect(m.toast).not.toHaveBeenCalled();
    expect(m.refresh).toHaveBeenCalledTimes(reads);
    expect(entry.pending.value).toBe(false);
  },
);

it("drops obsolete enable-VCS success feedback after navigation", async () => {
  const enabling = deferred<ReturnType<typeof result>>();
  useWorkspaceStore().folderPath = "folder";
  m.vcsEnable.mockReturnValue(enabling.promise);
  const first = run("Start.Use.Vcs");
  await useWorkspaceStore().openFolder("newer");
  enabling.resolve(result("folder"));
  await first;
  expect(useWorkspaceStore().folderPath).toBe("newer");
  expect(m.toast).not.toHaveBeenCalled();
  expect(m.refresh).not.toHaveBeenCalled();
});

it.each(["File.OpenFolder", "Git.Init"])(
  "%s releases cancelled or failed pickers for retry",
  async (id) => {
    const entry = componentEntry();
    m.pick.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("Picker unavailable"));
    await run(id);
    expect(entry.pending.value).toBe(false);
    expect(entry.error.value).toBeNull();
    expect(m.workspaceOpen).not.toHaveBeenCalled();
    expect(m.initRun).not.toHaveBeenCalled();
    await run(id);
    expect(entry.error.value).toBe("Picker unavailable");
    expect(isEnabled(getAction(id)!, context())).toBe(true);
    m.pick.mockResolvedValueOnce("retry");
    await run(id);
    expect(entry.error.value).toBeNull();
    expect(useWorkspaceStore().folderPath).toBe("retry");
    expect(m.toast).toHaveBeenCalledOnce();
  },
);

it("keeps the new action busy when a retired action fails late", async () => {
  const old = deferred<ReturnType<typeof result>>();
  const newer = deferred<ReturnType<typeof result>>();
  m.pick.mockResolvedValueOnce("old").mockResolvedValueOnce("newer");
  m.workspaceOpen.mockReturnValueOnce(old.promise);
  const entry = componentEntry();
  const first = run();
  await flushPromises();
  await useWorkspaceStore().openFolder("external navigation");
  expect(entry.pending.value).toBe(false);
  m.workspaceOpen.mockReturnValueOnce(newer.promise);
  const second = run();
  await flushPromises();
  old.reject(new Error("Obsolete failure"));
  await first;
  expect(entry.pending.value).toBe(true);
  expect(entry.pendingPath.value).toBe("newer");
  expect(entry.error.value).toBeNull();
  expect(m.toast).not.toHaveBeenCalled();
  newer.resolve(result("newer"));
  await second;
  expect(entry.pending.value).toBe(false);
  expect(useWorkspaceStore().folderPath).toBe("newer");
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({ title: "Opened", description: "newer" });
});

it("does not carry pending action state into another Pinia application", async () => {
  const firstPicker = deferred<string | null>();
  const secondPicker = deferred<string | null>();
  m.pick.mockReturnValueOnce(firstPicker.promise).mockReturnValueOnce(secondPicker.promise);
  const firstEntry = componentEntry();
  const first = run();
  await flushPromises();
  setActivePinia(createPinia());
  const secondEntry = componentEntry();
  expect(firstEntry.pending.value).toBe(true);
  expect(secondEntry.pending.value).toBe(false);
  expect(isEnabled(getAction("Git.Init")!, context())).toBe(true);
  const second = run("Git.Init");
  await flushPromises();
  expect(m.pick).toHaveBeenCalledTimes(2);
  firstPicker.resolve(null);
  await first;
  expect(firstEntry.pending.value).toBe(false);
  expect(secondEntry.pending.value).toBe(true);
  secondPicker.resolve(null);
  await second;
});

it("reports enable-VCS failure without losing the folder and permits retry", async () => {
  useWorkspaceStore().folderPath = "folder";
  const entry = componentEntry();
  m.vcsEnable.mockRejectedValueOnce({ message: "Permission denied" });
  await run("Start.Use.Vcs");
  expect(entry.pending.value).toBe(false);
  expect(useWorkspaceStore().folderPath).toBe("folder");
  expect(useWorkspaceStore().isRepo).toBe(false);
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({ title: "Permission denied" });
  await run("Start.Use.Vcs");
  expect(useWorkspaceStore().isRepo).toBe(true);
  expect(m.pick).not.toHaveBeenCalled();
  expect(m.refresh).toHaveBeenCalledOnce();
  expect(m.load).toHaveBeenCalledExactlyOnceWith(true, false, { taskOwned: true });
  expect(m.branches).toHaveBeenCalledOnce();
});
