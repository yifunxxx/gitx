import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { useJobsStore } from "./jobsStore";

const m = vi.hoisted(() => ({ list: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ jobList: m.list, jobCancel: m.cancel }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const native = { id: "slow", title: "Slow fetch", cancellable: true, startedAt: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  m.list.mockResolvedValue([native]);
  m.cancel.mockResolvedValue(true);
});

it("keeps an acknowledged cancellation visible until the native task really finishes", async () => {
  const jobs = useJobsStore();
  jobs.started(native, "native");
  expect(await jobs.cancel(native.id)).toBe(true);
  expect(jobs.count).toBe(1);
  expect(jobs.running[0]).toMatchObject({ id: native.id, cancelling: true });
  await jobs.refresh();
  expect(jobs.running[0]).toMatchObject({ id: native.id, cancelling: true });
  jobs.finished(native.id);
  expect(jobs.count).toBe(0);
});

it("marks cancellation immediately and prevents repeated requests before and after acknowledgement", async () => {
  const jobs = useJobsStore();
  jobs.started(native, "native");
  const request = deferred<boolean>();
  m.cancel.mockReturnValue(request.promise);
  const first = jobs.cancel(native.id);
  expect(jobs.running[0]).toMatchObject({ cancelling: true });
  expect(await jobs.cancel(native.id)).toBe(false);
  request.resolve(true);
  await first;
  expect(await jobs.cancel(native.id)).toBe(false);
  expect(m.cancel).toHaveBeenCalledOnce();
});

it("does not cancel missing or non-cancellable UI operations", async () => {
  const jobs = useJobsStore();
  jobs.begin("Commit");
  expect(await jobs.cancel("missing")).toBe(false);
  expect(await jobs.cancel(jobs.running[0]!.id)).toBe(false);
  expect(m.cancel).not.toHaveBeenCalled();
});

it.each(["false", "reject"])("allows retry when cancellation returns %s", async (mode) => {
  const jobs = useJobsStore();
  jobs.started(native, "native");
  if (mode === "false") m.cancel.mockResolvedValueOnce(false);
  else m.cancel.mockRejectedValueOnce(new Error("IPC unavailable"));
  if (mode === "false") expect(await jobs.cancel(native.id)).toBe(false);
  else await expect(jobs.cancel(native.id)).rejects.toThrow("IPC unavailable");
  expect(jobs.running[0]).toMatchObject({ cancelling: false });
  expect(jobs.count).toBe(1);
  expect(await jobs.cancel(native.id)).toBe(true);
  expect(m.cancel).toHaveBeenCalledTimes(2);
});

it.each(["resolve", "reject"])("ignores a late %s after completion and ID reuse", async (result) => {
  const jobs = useJobsStore();
  jobs.started(native, "native");
  const request = deferred<boolean>();
  m.cancel.mockReturnValueOnce(request.promise);
  const pending = jobs.cancel(native.id);
  jobs.finished(native.id);
  jobs.started({ ...native, title: "New task" }, "native");
  if (result === "resolve") request.resolve(true);
  else request.reject(new Error("job no longer found"));
  expect(await pending).toBe(false);
  expect(jobs.running[0]).toMatchObject({ title: "New task" });
  expect(jobs.running[0]?.cancelling).toBeFalsy();
  expect(await jobs.cancel(native.id)).toBe(true);
});

it("retains cancellation across progress, duplicate start events and popup reopen", async () => {
  const jobs = useJobsStore();
  jobs.started(native, "native");
  const request = deferred<boolean>();
  m.cancel.mockReturnValueOnce(request.promise);
  const pending = jobs.cancel(native.id);
  jobs.progress(native.id, { percent: 60, message: "Finishing cleanup" });
  jobs.started(native, "native");
  jobs.openPopup();
  jobs.closePopup();
  await Promise.resolve();
  expect(jobs.running[0]).toMatchObject({ cancelling: true });
  expect(await jobs.cancel(native.id)).toBe(false);
  request.resolve(true);
  expect(await pending).toBe(true);
});

it("reconciles a missed finish from native listing and suppresses its late cancel error", async () => {
  const jobs = useJobsStore();
  jobs.started(native, "native");
  const request = deferred<boolean>();
  m.cancel.mockReturnValueOnce(request.promise);
  const pending = jobs.cancel(native.id);
  m.list.mockResolvedValueOnce([]);
  await jobs.refresh();
  expect(jobs.count).toBe(0);
  request.reject(new Error("job no longer found"));
  expect(await pending).toBe(false);
});

it("rejects a native list read that started before the cancellation", async () => {
  const jobs = useJobsStore();
  jobs.started(native, "native");
  const snapshot = deferred<unknown[]>();
  m.list.mockReturnValueOnce(snapshot.promise);
  const refresh = jobs.refresh();
  await jobs.cancel(native.id);
  snapshot.resolve([]);
  await refresh;
  expect(jobs.running[0]).toMatchObject({ cancelling: true });
  m.list.mockResolvedValueOnce([]);
  await jobs.refresh();
  expect(jobs.count).toBe(0);
});

it("isolates cancellation of concurrent tasks", async () => {
  const jobs = useJobsStore();
  jobs.started(native, "native");
  jobs.started({ ...native, id: "other" }, "native");
  await jobs.cancel(native.id);
  expect(jobs.running.find(job => job.id === "other")?.cancelling).toBeFalsy();
  jobs.finished(native.id);
  expect(jobs.running.map(job => job.id)).toEqual(["other"]);
});

it("discards pending cancellation errors after store disposal", async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const jobs = useJobsStore();
  jobs.started(native, "native");
  const request = deferred<boolean>();
  m.cancel.mockReturnValueOnce(request.promise);
  const pending = jobs.cancel(native.id);
  disposePinia(pinia);
  request.reject(new Error("IPC disconnected"));
  expect(await pending).toBe(false);
  expect(await jobs.cancel(native.id)).toBe(false);
});
