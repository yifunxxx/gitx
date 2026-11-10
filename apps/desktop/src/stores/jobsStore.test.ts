import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useJobsStore } from "./jobsStore";
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ jobList: mocks.list }) }));
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
});
it("retains a long running native job and removes only jobs no longer running", async () => {
  const jobs = useJobsStore();
  jobs.started({ id: "gone", title: "completed" });
  mocks.list.mockResolvedValue([{ id: "long", title: "clone", startedAt: Date.now() - 600_000 }]);
  await jobs.refresh();
  expect(jobs.running.map((j) => j.id)).toEqual(["long"]);
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
