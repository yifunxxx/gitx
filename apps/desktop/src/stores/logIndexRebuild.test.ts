import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { reactive } from "vue";
import { useLogStore } from "./logStore";
import { useJobsStore } from "./jobsStore";

const m = vi.hoisted(() => ({
  ws: {} as any,
  backend: { logIndexStatus: vi.fn(), logIndexRebuild: vi.fn() },
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", async () => {
  const { withBackendActivity } =
    await vi.importActual<typeof import("@/lib/backend/activity")>("@/lib/backend/activity");
  const backend = withBackendActivity(m.backend);
  return { getBackend: () => backend };
});
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => m.ws }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));

function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const status = (commitCount: number) => ({
  enabled: true,
  ready: commitCount > 0,
  progress: 1,
  commitCount,
  message: "",
});
let pinia: Pinia;
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  m.ws = reactive({
    repoPath: "C:/project",
    repoId: "A",
    isRepo: true,
    generation: 1,
    navigationToken() {
      return this.generation;
    },
  });
  m.backend.logIndexStatus.mockResolvedValue(status(2));
  useJobsStore();
});
afterEach(() => disposePinia(pinia));
function navigate(path: string) {
  m.ws.repoPath = path;
  m.ws.repoId = path;
  m.ws.generation++;
}

it("deduplicates repeated rebuilds and retains one task until completion", async () => {
  const pending = deferred();
  m.backend.logIndexRebuild.mockReturnValue(pending.promise);
  const log = useLogStore();
  const first = log.rebuildIndex();
  const second = log.rebuildIndex();
  const requests = m.backend.logIndexRebuild.mock.calls.length;
  const tasks = useJobsStore().count;
  const busy = log.rebuildingIndex;
  pending.resolve(status(7));
  await Promise.all([first, second]);
  expect(requests).toBe(1);
  expect(tasks).toBe(1);
  expect(busy).toBe(true);
  expect(log.rebuildingIndex).toBe(false);
  expect(useJobsStore().count).toBe(0);
  expect(log.indexStatus).toEqual(status(7));
});

it("does not let background status reads supersede an active rebuild", async () => {
  const pending = deferred();
  m.backend.logIndexRebuild.mockReturnValue(pending.promise);
  const log = useLogStore();
  log.indexStatus = status(1);
  const request = log.rebuildIndex();
  await log.refreshIndexStatus();
  pending.resolve(status(8));
  await request;
  expect(m.backend.logIndexStatus).not.toHaveBeenCalled();
  expect(log.indexStatus).toEqual(status(8));
});

it("rejects a status snapshot started before rebuilding", async () => {
  const old = deferred();
  m.backend.logIndexStatus.mockReturnValueOnce(old.promise);
  m.backend.logIndexRebuild.mockResolvedValueOnce(status(8));
  const log = useLogStore();
  const read = log.refreshIndexStatus();
  await log.rebuildIndex();
  old.resolve(status(1));
  await read;
  expect(log.indexStatus).toEqual(status(8));
});

it.each([false, true])(
  "retains rebuild completion after filters change (failure: %s)",
  async (failure) => {
    const pending = deferred();
    m.backend.logIndexRebuild.mockReturnValueOnce(pending.promise);
    const log = useLogStore();
    const request = log.rebuildIndex();
    log.setTextFilter("filtered history");
    if (failure) pending.reject(new Error("index unavailable"));
    else pending.resolve(status(8));
    await request;
    if (failure)
      expect(m.toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "index unavailable" }),
      );
    else expect(log.indexStatus).toEqual(status(8));
    expect(log.rebuildingIndex).toBe(false);
  },
);

it("allows retry after failure and cleans up the task", async () => {
  m.backend.logIndexRebuild.mockRejectedValueOnce(new Error("locked"));
  const log = useLogStore();
  log.indexStatus = status(1);
  await log.rebuildIndex();
  expect(log.rebuildingIndex).toBe(false);
  expect(log.indexStatus).toEqual(status(1));
  expect(useJobsStore().count).toBe(0);
  m.backend.logIndexRebuild.mockResolvedValueOnce(status(9));
  await log.rebuildIndex();
  expect(log.indexStatus).toEqual(status(9));
  expect(m.backend.logIndexRebuild).toHaveBeenCalledTimes(2);
});

it("scopes pending work to its repository and keeps a newer task busy", async () => {
  const a = deferred(),
    b = deferred();
  m.backend.logIndexRebuild.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const log = useLogStore();
  const first = log.rebuildIndex();
  navigate("C:/other");
  const idleInB = log.rebuildingIndex;
  const second = log.rebuildIndex();
  a.resolve(status(3));
  await first;
  const busyInB = log.rebuildingIndex;
  const tasks = useJobsStore().count;
  const oldResult = log.indexStatus;
  b.resolve(status(6));
  await second;
  expect(idleInB).toBe(false);
  expect(busyInB).toBe(true);
  expect(tasks).toBe(1);
  expect(oldResult).toBeNull();
  expect(log.indexStatus).toEqual(status(6));
});

it.each(["C:/project", "c:\\PROJECT\\"])(
  "keeps a pending rebuild on returning to %s and rereads current status",
  async (path) => {
    const pending = deferred();
    m.backend.logIndexRebuild.mockReturnValue(pending.promise);
    const log = useLogStore();
    const request = log.rebuildIndex();
    navigate("C:/other");
    navigate(path);
    const busy = log.rebuildingIndex;
    const repeat = log.rebuildIndex();
    pending.resolve(status(7));
    await Promise.all([request, repeat]);
    expect(busy).toBe(true);
    expect(m.backend.logIndexRebuild).toHaveBeenCalledTimes(1);
    expect(m.backend.logIndexStatus).toHaveBeenCalledExactlyOnceWith({ path });
    expect(log.indexStatus).toEqual(status(2));
    expect(log.rebuildingIndex).toBe(false);
  },
);

it("suppresses old errors in another repository and releases their task", async () => {
  const pending = deferred();
  m.backend.logIndexRebuild.mockReturnValueOnce(pending.promise);
  const log = useLogStore();
  const request = log.rebuildIndex();
  navigate("C:/other");
  pending.reject(new Error("old repository failure"));
  await request;
  expect(m.toast).not.toHaveBeenCalled();
  expect(m.backend.logIndexStatus).not.toHaveBeenCalled();
  expect(useJobsStore().count).toBe(0);
  expect(log.rebuildingIndex).toBe(false);
});

it("does not publish or reread status after store disposal", async () => {
  const pending = deferred();
  m.backend.logIndexRebuild.mockReturnValueOnce(pending.promise);
  const log = useLogStore();
  const request = log.rebuildIndex();
  log.$dispose();
  pending.resolve(status(4));
  await request;
  expect(log.indexStatus).toBeNull();
  expect(m.backend.logIndexStatus).not.toHaveBeenCalled();
  expect(useJobsStore().count).toBe(0);
});
