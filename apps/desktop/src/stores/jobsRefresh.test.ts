import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { useJobsStore } from "./jobsStore";

const m = vi.hoisted(() => ({ list: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ jobList: m.list, jobCancel: m.cancel }) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));

let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  m.list.mockResolvedValue([]);
});
afterEach(() => disposePinia(pinia));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("retains the failure and current rows until a successful retry reconciles the list", async () => {
  const jobs = useJobsStore();
  jobs.started({ id: "native", title: "Native" }, "native");
  const ui = jobs.begin("Saving file");
  m.list.mockRejectedValueOnce({ message: "read failed" });
  await expect(jobs.refresh()).rejects.toEqual({ message: "read failed" });
  expect(jobs.refreshError).toBe("read failed");
  expect(jobs.running.map((job) => job.id)).toEqual(["native", ui]);
  const retry = deferred<unknown[]>();
  m.list.mockReturnValueOnce(retry.promise);
  const pending = jobs.refresh();
  expect(jobs.refreshing).toBe(true);
  expect(jobs.refreshError).toBe("read failed");
  retry.resolve([]);
  await pending;
  expect(jobs.refreshing).toBe(false);
  expect(jobs.refreshError).toBe("");
  expect(jobs.running.map((job) => job.id)).toEqual([ui]);
});

it("records a list failure even if task events arrived during the read", async () => {
  const jobs = useJobsStore();
  const read = deferred<unknown[]>();
  m.list.mockReturnValueOnce(read.promise);
  const pending = jobs.refresh();
  jobs.started({ id: "new", title: "New native task" }, "native");
  read.reject(new Error("list disconnected"));
  await expect(pending).rejects.toThrow("list disconnected");
  expect(jobs.refreshError).toBe("list disconnected");
  expect(jobs.running.map((job) => job.id)).toEqual(["new"]);
  expect(jobs.refreshing).toBe(false);
});

it("does not clear a previous failure with a snapshot superseded by a task event", async () => {
  const jobs = useJobsStore();
  m.list.mockRejectedValueOnce(new Error("list failed"));
  await expect(jobs.refresh()).rejects.toThrow("list failed");
  const read = deferred<unknown[]>();
  m.list.mockReturnValueOnce(read.promise);
  const pending = jobs.refresh();
  jobs.started({ id: "new", title: "New native task" }, "native");
  read.resolve([]);
  await pending;
  expect(jobs.refreshError).toBe("list failed");
  expect(jobs.running.map((job) => job.id)).toEqual(["new"]);
  expect(jobs.refreshing).toBe(false);
});

it.each(["invalidated", "disposed"])(
  "ignores a delayed failure after its owner is %s",
  async (mode) => {
    const jobs = useJobsStore();
    const read = deferred<unknown[]>();
    m.list.mockReturnValueOnce(read.promise);
    let current = true;
    const pending = jobs.refresh(() => current);
    if (mode === "disposed") disposePinia(pinia);
    else current = false;
    read.reject(new Error("obsolete error"));
    await expect(pending).resolves.toBeUndefined();
    expect(jobs.refreshError).toBe("");
    expect(jobs.refreshing).toBe(false);
  },
);

it("does not begin reads after store disposal or with an inactive owner", async () => {
  const jobs = useJobsStore();
  await jobs.refresh(() => false);
  disposePinia(pinia);
  await jobs.refresh();
  expect(m.list).not.toHaveBeenCalled();
});

it("retains an accepted cancellation across a failed read and successful retry", async () => {
  const jobs = useJobsStore();
  const native = { id: "cancelled", title: "Cancelling fetch", cancellable: true, startedAt: 1 };
  jobs.started(native, "native");
  m.cancel.mockResolvedValue(true);
  await jobs.cancel(native.id);
  m.list.mockRejectedValueOnce(new Error("read failed"));
  await expect(jobs.refresh()).rejects.toThrow("read failed");
  expect(jobs.running[0]?.cancelling).toBe(true);
  m.list.mockResolvedValueOnce([native]);
  await jobs.refresh();
  expect(jobs.refreshError).toBe("");
  expect(jobs.running[0]?.cancelling).toBe(true);
  expect(await jobs.cancel(native.id)).toBe(false);
  expect(m.cancel).toHaveBeenCalledOnce();
  await jobs.refresh();
  expect(jobs.count).toBe(0);
});

it("coalesces repeated refresh requests without automatically retrying errors", async () => {
  const jobs = useJobsStore();
  const read = deferred<unknown[]>();
  m.list.mockReturnValueOnce(read.promise);
  jobs.openPopup();
  await jobs.refresh();
  jobs.openPopup();
  expect(m.list).toHaveBeenCalledOnce();
  read.reject(new Error("read failed"));
  await read.promise.catch(() => {});
  await Promise.resolve();
  expect(jobs.refreshError).toBe("read failed");
  expect(jobs.refreshing).toBe(false);
  expect(m.list).toHaveBeenCalledOnce();
});
