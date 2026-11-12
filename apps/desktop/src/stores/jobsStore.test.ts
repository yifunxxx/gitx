import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useJobsStore } from "./jobsStore";
const mocks = vi.hoisted(() => ({ list: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({ jobList: mocks.list, jobCancel: mocks.cancel }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
});
it("retains a long running native job and removes only jobs no longer running", async () => {
  const jobs = useJobsStore();
  jobs.started({ id: "gone", title: "completed" });
  mocks.list.mockResolvedValue([
    { id: "long", title: "clone", startedAt: Date.now() - 600_000, cancellable: true },
  ]);
  await jobs.refresh();
  expect(jobs.running.map((j) => j.id)).toEqual(["long"]);
  expect(jobs.running[0]?.cancellable).toBe(true);
});
it("opens a popup anchor and cancels a running job", async () => {
  const jobs = useJobsStore();
  jobs.started({ id: "pull", title: "Pulling…", cancellable: true, message: "Fetching…" });
  mocks.list.mockResolvedValue([]);
  jobs.openPopup({ x: 12, y: 640 });
  expect(jobs.popupOpen).toBe(true);
  expect(jobs.anchorX).toBe(12);
  expect(jobs.anchorY).toBe(640);
  mocks.cancel.mockResolvedValue(true);
  await expect(jobs.cancel("pull")).resolves.toBe(true);
  expect(jobs.count).toBe(0);
  jobs.closePopup();
  expect(jobs.popupOpen).toBe(false);
});
it("keeps progress details across a native list refresh", async () => {
  const jobs = useJobsStore();
  jobs.started({ id: "clone", title: "Cloning…", message: "Receiving objects", percent: 42 });
  mocks.list.mockResolvedValue([
    { id: "clone", title: "Cloning…", startedAt: 1, cancellable: true },
  ]);
  await jobs.refresh();
  expect(jobs.running[0]).toMatchObject({
    id: "clone",
    percent: 42,
    message: "Receiving objects",
    cancellable: true,
  });
});
it("rejects snapshots superseded by job events and coalesces overlapping polls", async () => {
  const jobs = useJobsStore();
  let resolve!: (value: unknown[]) => void;
  mocks.list.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const request = jobs.refresh();
  await jobs.refresh();
  expect(mocks.list).toHaveBeenCalledOnce();
  jobs.started({ id: "new", title: "active" });
  resolve([]);
  await request;
  expect(jobs.count).toBe(1);
});
it("ignores snapshots returned after the owner was disposed and recovers from errors", async () => {
  const jobs = useJobsStore();
  mocks.list.mockResolvedValueOnce([{ id: "old", title: "old", startedAt: 0 }]);
  await jobs.refresh(() => false);
  expect(jobs.count).toBe(0);
  mocks.list.mockRejectedValueOnce(new Error("offline"));
  await expect(jobs.refresh()).rejects.toThrow("offline");
  mocks.list.mockResolvedValueOnce([]);
  await expect(jobs.refresh()).resolves.toBeUndefined();
});
