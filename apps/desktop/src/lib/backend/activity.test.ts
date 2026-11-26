import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { useJobsStore } from "@/stores/jobsStore";
import { withBackendActivity } from "./activity";

vi.mock("@/lib/backend", () => ({ getBackend: () => ({ jobList: async () => [] }) }));

it.each(["stageHunks", "unstageHunks", "revertHunks"])(
  "tracks %s through completion and failure without leaking a queue entry",
  async (method) => {
    const jobs = useJobsStore();
    const pending = deferred<null>();
    const backend = withBackendActivity({ [method]: (_req: unknown) => pending.promise });
    const request = backend[method]!({ path: "C:/repo", filePath: "file.txt", hunkIndexes: [0] });
    expect(jobs.count).toBe(1);
    expect(jobs.running[0]).toMatchObject({ message: "C:/repo", cancellable: false });
    const error = new Error("index lock");
    pending.reject(error);
    await expect(request).rejects.toBe(error);
    expect(jobs.count).toBe(0);
  },
);
let pinia: Pinia;
beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
});
afterEach(() => disposePinia(pinia));
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("shows plain workspace saves in the queue without exposing file content", async () => {
  const jobs = useJobsStore();
  const pending = deferred<null>();
  const backend = withBackendActivity({ fsWriteFile: vi.fn((_req: unknown) => pending.promise) });
  const request = backend.fsWriteFile({
    folderPath: "C:/plain",
    filePath: "file.txt",
    content: "private document body",
  });
  expect(jobs.running).toEqual([
    expect.objectContaining({ message: "C:/plain", cancellable: false }),
  ]);
  expect(JSON.stringify(jobs.running)).not.toContain("private document body");
  await jobs.refresh();
  expect(jobs.count).toBe(1);
  const error = new Error("write denied");
  pending.reject(error);
  await expect(request).rejects.toBe(error);
  expect(jobs.count).toBe(0);
});

it("tracks overlapping operations independently and survives native reconciliation", async () => {
  const jobs = useJobsStore();
  const a = deferred<null>(),
    b = deferred<null>();
  const backend = withBackendActivity({
    branchCreate: vi.fn((_req: unknown) => a.promise),
    commitCreate: vi.fn((_req: unknown) => b.promise),
  });
  const first = backend.branchCreate({ path: "A", name: "feature/a" });
  const second = backend.commitCreate({ path: "B", message: "not task metadata" });
  expect(jobs.count).toBe(2);
  expect(jobs.running[0]).toMatchObject({ message: "A", cancellable: false });
  expect(jobs.running[0]!.title).toContain("feature/a");
  expect(JSON.stringify(jobs.running)).not.toContain("not task metadata");
  await jobs.refresh();
  expect(jobs.count).toBe(2);
  b.resolve(null);
  expect(await second).toBeNull();
  expect(jobs.running.map((job) => job.message)).toEqual(["A"]);
  a.resolve(null);
  await first;
  expect(jobs.count).toBe(0);
});

it("preserves rejected errors, synchronous throws and structured failures without stuck tasks", async () => {
  const jobs = useJobsStore();
  const error = new Error("index locked");
  const result = { ok: false, conflicts: ["a.txt"] };
  const backend = withBackendActivity({
    mergeRun: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(result),
    stagePaths: () => {
      throw error;
    },
  });
  await expect(backend.mergeRun()).rejects.toBe(error);
  expect(jobs.count).toBe(0);
  expect(await backend.mergeRun()).toBe(result);
  expect(jobs.count).toBe(0);
  await expect(backend.stagePaths()).rejects.toBe(error);
  expect(jobs.count).toBe(0);
});

it("does not turn background reads or already owned operations into duplicate tasks", async () => {
  const jobs = useJobsStore();
  const pending = deferred<null>();
  const keys = [
    "statusGet",
    "refsList",
    "logQuery",
    "settingsSet",
    "jobList",
    "cloneRun",
    "statusProbe",
    "fetchRun",
    "pushRun",
    "pullRun",
    "updateProjectRun",
    "branchCheckout",
    "multiRootCheckout",
    "multiRootRollback",
    "fsMutate",
    "fsReadDir",
    "fsReadFile",
    "fsSearchNames",
    "fsSearchContent",
  ];
  const original = Object.fromEntries(keys.map((key) => [key, () => pending.promise]));
  const backend = withBackendActivity(original);
  const requests = keys.map((key) => {
    expect(backend[key]).toBe(original[key]);
    return backend[key]!();
  });
  expect(jobs.count).toBe(0);
  pending.resolve(null);
  await Promise.all(requests);
});

it("keeps a pending operation attached to its original store after disposal and recreation", async () => {
  const old = useJobsStore();
  const pending = deferred<null>();
  const backend = withBackendActivity({ commitCreate: () => pending.promise });
  const request = backend.commitCreate();
  old.$dispose();
  pinia.state.value.jobs = undefined as any;
  const next = useJobsStore();
  const active = next.begin("new operation");
  pending.resolve(null);
  await request;
  expect(next.running.map((job) => job.id)).toEqual([active]);
});

it("works without an initialized task UI and preserves method this and arguments", async () => {
  const original = {
    value: 2,
    async branchCreate(n: number) {
      return this.value + n;
    },
  };
  const backend = withBackendActivity(original);
  expect(await backend.branchCreate(3)).toBe(5);
  expect(backend.branchCreate).toBe(backend.branchCreate);
});
