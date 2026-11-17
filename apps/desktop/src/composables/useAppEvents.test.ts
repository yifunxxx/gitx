import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { useAppEvents } from "./useAppEvents";
enableAutoUnmount(afterEach);
const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  append: vi.fn(),
  jobs: { refresh: vi.fn(), started: vi.fn(), progress: vi.fn(), finished: vi.fn() },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/lib/utils", () => ({ isTauri: () => true }));
vi.mock("@/stores/jobsStore", () => ({ useJobsStore: () => mocks.jobs }));
vi.mock("@/stores/consoleStore", () => ({ useConsoleStore: () => ({ append: mocks.append }) }));
const Host = defineComponent({
  setup() {
    useAppEvents();
    return () => null;
  },
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.jobs.refresh.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
it("releases every listener even when registration completes after unmount", async () => {
  const cleanups = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
  let finish!: (cleanup: () => void) => void;
  mocks.listen
    .mockResolvedValueOnce(cleanups[0])
    .mockReturnValueOnce(
      new Promise((done) => {
        finish = done;
      }),
    )
    .mockResolvedValueOnce(cleanups[2])
    .mockResolvedValueOnce(cleanups[3]);
  const host = mount(Host);
  await flushPromises();
  host.unmount();
  finish(cleanups[1]!);
  await flushPromises();
  cleanups.forEach((cleanup) => expect(cleanup).toHaveBeenCalledOnce());
  for (const [name, callback] of mocks.listen.mock.calls)
    callback({
      payload: name === "console://line" ? { stream: "stdout", line: "late" } : { id: "late" },
    });
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.jobs.started).not.toHaveBeenCalled();
  expect(mocks.jobs.progress).not.toHaveBeenCalled();
  expect(mocks.jobs.refresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.jobs.refresh).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("keeps successful subscriptions after a partial failure and stops reconciliation on unmount", async () => {
  const cleanup = vi.fn();
  mocks.listen.mockResolvedValue(cleanup).mockRejectedValueOnce(new Error("console unavailable"));
  const host = mount(Host);
  await flushPromises();
  expect(mocks.jobs.refresh).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.jobs.refresh).toHaveBeenCalledTimes(2);
  const isCurrent = mocks.jobs.refresh.mock.lastCall![0];
  host.unmount();
  expect(isCurrent()).toBe(false);
  expect(cleanup).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});
