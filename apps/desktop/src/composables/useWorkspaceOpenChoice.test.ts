import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { createWorkspaceOpen } from "./useWorkspaceOpen";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const m = vi.hoisted(() => ({
  workspaceOpen: vi.fn(),
  workspaceRecent: vi.fn(),
  initRun: vi.fn(),
  vcsEnable: vi.fn(),
  appOpenNewWindow: vi.fn(),
  refresh: vi.fn(),
  load: vi.fn(),
  branches: vi.fn(),
  pick: vi.fn(),
  toast: vi.fn(),
  jobList: vi.fn(),
  choose: vi.fn(),
}));
vi.mock("@/lib/backend", async () => {
  const { withBackendActivity } = await import("@/lib/backend/activity");
  const backend = withBackendActivity(m);
  return { getBackend: () => backend };
});
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

let pinia: ReturnType<typeof createPinia>;
const opened = (path: string) => ({
  path,
  isRepo: true,
  gitDir: `${path}/.git`,
  toplevel: path,
});
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  m.workspaceOpen.mockImplementation(async ({ path }) => opened(path));
  m.initRun.mockImplementation(async ({ path }) => opened(path));
  m.workspaceRecent.mockResolvedValue({ paths: [] });
  m.jobList.mockResolvedValue([]);
  m.appOpenNewWindow.mockResolvedValue(null);
  m.choose.mockResolvedValue("here");
  m.pick.mockResolvedValue("B");
});
afterEach(() => {
  disposePinia(pinia);
});

it("opens directly on Welcome without asking", async () => {
  const entry = createWorkspaceOpen((key) => key);
  await entry.openRecent("A");
  expect(m.choose).toHaveBeenCalledWith({ currentPath: null, nextPath: "A" });
  expect(m.workspaceOpen).toHaveBeenCalledWith({ path: "A" });
  expect(m.appOpenNewWindow).not.toHaveBeenCalled();
  expect(useWorkspaceStore().folderPath).toBe("A");
});

it("replaces this window when the user chooses here", async () => {
  const ws = useWorkspaceStore();
  await ws.openFolder("A");
  m.workspaceOpen.mockClear();
  m.choose.mockResolvedValueOnce("here");
  await createWorkspaceOpen((key) => key).openRecent("B");
  expect(m.choose).toHaveBeenCalledWith({ currentPath: "A", nextPath: "B" });
  expect(m.workspaceOpen).toHaveBeenCalledWith({ path: "B" });
  expect(ws.folderPath).toBe("B");
  expect(m.appOpenNewWindow).not.toHaveBeenCalled();
});

it("spawns a new window and keeps the current project", async () => {
  const ws = useWorkspaceStore();
  await ws.openFolder("A");
  m.workspaceOpen.mockClear();
  m.choose.mockResolvedValueOnce("new");
  await createWorkspaceOpen((key) => key).openRecent("B");
  expect(m.appOpenNewWindow).toHaveBeenCalledExactlyOnceWith("B");
  expect(m.workspaceOpen).not.toHaveBeenCalled();
  expect(ws.folderPath).toBe("A");
});

it("cancelling the choice leaves the current project alone", async () => {
  const ws = useWorkspaceStore();
  await ws.openFolder("A");
  m.workspaceOpen.mockClear();
  m.choose.mockResolvedValueOnce(null);
  await createWorkspaceOpen((key) => key).openFolder();
  expect(m.pick).toHaveBeenCalledOnce();
  expect(m.workspaceOpen).not.toHaveBeenCalled();
  expect(m.appOpenNewWindow).not.toHaveBeenCalled();
  expect(ws.folderPath).toBe("A");
});

it("creates a repo then opens it in a new window", async () => {
  const ws = useWorkspaceStore();
  await ws.openFolder("A");
  m.pick.mockResolvedValueOnce("fresh");
  m.choose.mockResolvedValueOnce("new");
  await createWorkspaceOpen((key) => key).createRepo();
  await flushPromises();
  expect(m.initRun).toHaveBeenCalledWith({ path: "fresh", initialBranch: "main" });
  expect(m.appOpenNewWindow).toHaveBeenCalledExactlyOnceWith("fresh");
  expect(ws.folderPath).toBe("A");
});

it("does not ask when enabling VCS in the current folder", async () => {
  const ws = useWorkspaceStore();
  ws.folderPath = "A";
  ws.isRepo = false;
  m.vcsEnable.mockResolvedValueOnce(opened("A"));
  await createWorkspaceOpen((key) => key).enableVcs();
  expect(m.choose).not.toHaveBeenCalled();
  expect(m.vcsEnable).toHaveBeenCalledOnce();
});
