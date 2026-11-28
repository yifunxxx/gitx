import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { useWorkspaceStore } from "./workspaceStore";
import { useWorktreesStore } from "./worktreesStore";
import { useJobsStore } from "./jobsStore";
import { createWorkspaceOpen, isWorkspaceOpening } from "@/composables/useWorkspaceOpen";
import WorktreesView from "@/features/worktrees/WorktreesView.vue";
import { i18n } from "@/i18n";

const m = vi.hoisted(() => ({
  backend: {
    workspaceOpen: vi.fn(),
    workspaceRecent: vi.fn(),
    appOpenNewWindow: vi.fn(),
    worktreeList: vi.fn(),
    worktreeAdd: vi.fn(),
    worktreeOpenRef: vi.fn(),
  },
  choose: vi.fn(),
  toast: vi.fn(),
  changes: vi.fn(),
  log: vi.fn(),
  branches: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m.backend }));
vi.mock("@/composables/useOpenProjectChoice", () => ({ chooseOpenProjectTarget: m.choose }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/composables/useConfirm", () => ({ confirmDialog: vi.fn(), promptDialog: vi.fn() }));
vi.mock("@/composables/useDialog", () => ({ openDialog: vi.fn() }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: m.changes }) }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => ({ load: m.log }) }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({ refresh: m.branches }) }));

enableAutoUnmount(afterEach);
let pinia: ReturnType<typeof createPinia>;
const releases: Array<() => void> = [];
const operations: Promise<unknown>[] = [];
function deferred<T>(fallback: T) {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  releases.push(() => resolve(fallback));
  return { promise, resolve, reject };
}
function track<T>(promise: Promise<T>) {
  operations.push(promise);
  return promise;
}
const opened = (path: string) => ({ path, isRepo: true, gitDir: `${path}/.git`, toplevel: path });

beforeEach(async () => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  m.backend.workspaceOpen.mockImplementation(async ({ path }) => opened(path));
  m.backend.workspaceRecent.mockResolvedValue({ paths: [] });
  m.backend.appOpenNewWindow.mockResolvedValue(null);
  m.backend.worktreeList.mockResolvedValue([]);
  m.backend.worktreeAdd.mockResolvedValue({ worktreePath: "B", openAfter: true });
  m.backend.worktreeOpenRef.mockResolvedValue({ worktreePath: "B", openAfter: true });
  m.choose.mockResolvedValue("here");
  m.changes.mockResolvedValue(undefined);
  m.log.mockResolvedValue(undefined);
  m.branches.mockResolvedValue(undefined);
  await useWorkspaceStore().openFolder("A");
  m.backend.workspaceOpen.mockClear();
});
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(operations.splice(0));
  await flushPromises();
  disposePinia(pinia);
});

it.each(["worktree", "recent"])(
  "shares the pending choice with %s and all other open entries",
  async (first) => {
    const choice = deferred<"here" | null>(null);
    m.choose.mockReturnValue(choice.promise);
    const trees = useWorktreesStore();
    const entry = createWorkspaceOpen((key) => key);
    const opening = track(
      first === "worktree" ? trees.openWorktree("B", false) : entry.openRecent("B"),
    );
    await flushPromises();
    track(trees.openWorktree("C", false));
    track(entry.openRecent("C"));
    expect(m.choose).toHaveBeenCalledOnce();
    expect(isWorkspaceOpening()).toBe(true);
    choice.resolve(null);
    await opening;
    expect(isWorkspaceOpening()).toBe(false);
    expect(m.backend.workspaceOpen).not.toHaveBeenCalled();
  },
);

it.each(["here", "new"] as const)(
  "ignores a late %s choice after another navigation",
  async (target) => {
    const choice = deferred<typeof target | null>(null);
    m.choose.mockReturnValueOnce(choice.promise);
    const opening = track(useWorktreesStore().openWorktree("B", false));
    await useWorkspaceStore().openFolder("C");
    choice.resolve(target);
    await opening;
    expect(useWorkspaceStore().repoPath).toBe("C");
    expect(m.backend.workspaceOpen).toHaveBeenCalledExactlyOnceWith({ path: "C" });
    expect(m.backend.appOpenNewWindow).not.toHaveBeenCalled();
    expect(m.toast).not.toHaveBeenCalled();
  },
);

it("suppresses repeated new-window requests while preserving the double-click preference", async () => {
  const launch = deferred(null);
  m.choose.mockResolvedValue("new");
  m.backend.appOpenNewWindow.mockReturnValue(launch.promise);
  const trees = useWorktreesStore();
  const opening = track(trees.openWorktree("B", true));
  await flushPromises();
  track(trees.openWorktree("B", true));
  await flushPromises();
  expect(m.choose).toHaveBeenCalledExactlyOnceWith({
    currentPath: "A",
    nextPath: "B",
    preferNewWindow: true,
  });
  expect(m.backend.appOpenNewWindow).toHaveBeenCalledExactlyOnceWith("B");
  expect(isWorkspaceOpening()).toBe(true);
  expect(useJobsStore().count).toBe(1);
  launch.resolve(null);
  await opening;
  expect(useWorkspaceStore().repoPath).toBe("A");
  expect(isWorkspaceOpening()).toBe(false);
  expect(useJobsStore().count).toBe(0);
  expect(m.changes).not.toHaveBeenCalled();
});

it("does not report an obsolete new-window failure in another repository", async () => {
  const launch = deferred(null);
  m.choose.mockResolvedValue("new");
  m.backend.appOpenNewWindow.mockReturnValueOnce(launch.promise);
  const opening = track(useWorktreesStore().openWorktree("B", true));
  await flushPromises();
  await useWorkspaceStore().openFolder("C");
  launch.reject(new Error("Old window failure"));
  await opening;
  expect(m.toast).not.toHaveBeenCalled();
  expect(useWorkspaceStore().repoPath).toBe("C");
});

it.each(["success", "failure"])(
  "keeps one task through the initial reads and releases it on %s",
  async (outcome) => {
    const files = deferred(undefined);
    m.changes.mockReturnValueOnce(files.promise);
    const opening = track(useWorktreesStore().openWorktree("B", false));
    await flushPromises();
    expect(useWorkspaceStore().repoPath).toBe("B");
    expect(isWorkspaceOpening()).toBe(true);
    expect(useJobsStore().count).toBe(1);
    expect(m.log).toHaveBeenCalledExactlyOnceWith(true, false, { taskOwned: true });
    expect(m.branches).toHaveBeenCalledOnce();
    if (outcome === "success") files.resolve(undefined);
    else files.reject(new Error("Initial status failed"));
    await opening;
    expect(isWorkspaceOpening()).toBe(false);
    expect(useJobsStore().count).toBe(0);
    if (outcome === "failure")
      expect(m.toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Initial status failed" }),
      );
  },
);

it.each(["create", "openRef"] as const)(
  "uses the same initial-read lifecycle for %s automatic opening",
  async (method) => {
    const files = deferred(undefined);
    m.changes.mockReturnValueOnce(files.promise);
    const trees = useWorktreesStore();
    const opening = track(
      method === "create"
        ? trees.create({ worktreePath: "B", startRef: "main", openAfter: true })
        : trees.openRef({
            worktreePath: "B",
            remote: "origin",
            refspec: "refs/pull/1/head",
            reviewName: "1",
          }),
    );
    await flushPromises();
    expect(m.changes).toHaveBeenCalledOnce();
    expect(isWorkspaceOpening()).toBe(true);
    expect(useJobsStore().count).toBe(1);
    files.resolve(undefined);
    await opening;
    expect(useWorkspaceStore().repoPath).toBe("B");
    expect(useJobsStore().count).toBe(0);
  },
);

it("allows retry after cancelling the choice and after a current open failure", async () => {
  const trees = useWorktreesStore();
  m.choose.mockResolvedValueOnce(null);
  await trees.openWorktree("B", false);
  expect(isWorkspaceOpening()).toBe(false);
  expect(m.backend.workspaceOpen).not.toHaveBeenCalled();
  m.backend.workspaceOpen.mockRejectedValueOnce(new Error("Cannot open B"));
  await trees.openWorktree("B", false);
  expect(m.toast).toHaveBeenCalledWith({ title: "Cannot open B" });
  expect(isWorkspaceOpening()).toBe(false);
  await trees.openWorktree("B", false);
  expect(useWorkspaceStore().repoPath).toBe("B");
  expect(useJobsStore().count).toBe(0);
});

it("disables row opening and shows busy feedback until the shared choice is cancelled", async () => {
  const trees = useWorktreesStore();
  const rows = ["A", "B"].map((path) => ({
    path,
    head: "abc1234",
    branch: "main",
    isCurrent: path === "A",
    isMain: path === "A",
    locked: false,
  }));
  m.backend.worktreeList.mockResolvedValue(rows);
  trees.items = rows as typeof trees.items;
  trees.selectedPath = "B";
  const wrapper = mount(WorktreesView, { global: { plugins: [pinia, i18n] } });
  await flushPromises();
  const button = () =>
    wrapper
      .findAll("button")
      .find((node) => node.text().includes(i18n.global.t("worktrees.openHere")))!;
  const choice = deferred<null>(null);
  m.choose.mockReturnValueOnce(choice.promise);
  await button().trigger("click");
  await flushPromises();
  expect(button().attributes("disabled")).toBeDefined();
  expect(button().attributes("aria-busy")).toBe("true");
  expect(wrapper.get('button[aria-pressed="true"]').attributes("disabled")).toBeDefined();
  expect(button().find('[role="status"]').exists()).toBe(true);
  choice.resolve(null);
  await flushPromises();
  expect(button().attributes("disabled")).toBeUndefined();
  expect(button().attributes("aria-busy")).toBe("false");
});
