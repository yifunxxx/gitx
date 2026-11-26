import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import JobsPopup from "./JobsPopup.vue";
import { useJobsStore } from "@/stores/jobsStore";
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  list: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({ jobList: mocks.list, jobCancel: mocks.cancel }),
}));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.list.mockResolvedValue([]);
  mocks.cancel.mockResolvedValue(true);
});
afterEach(() => {
  document.body.innerHTML = "";
});

it("lists running jobs with progress and cancels a cancellable job", async () => {
  const jobs = useJobsStore();
  jobs.started(
    {
      id: "clone",
      title: "Cloning repository…",
      message: "Receiving objects",
      percent: 45,
      cancellable: true,
    },
    "native",
  );
  mocks.list.mockResolvedValue([
    {
      id: "clone",
      title: "Cloning repository…",
      startedAt: Date.now(),
      cancellable: true,
      kind: "network",
      repoIds: [],
      background: true,
    },
  ]);
  jobs.openPopup({ x: 16, y: 700 });
  mount(JobsPopup, { attachTo: document.body });
  await flushPromises();
  const menu = document.querySelector('[role="dialog"]');
  expect(menu?.textContent).toContain("Cloning repository…");
  expect(menu?.textContent).toContain("Receiving objects");
  expect(menu?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("45");
  const cancel = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ).find((item) => item.textContent?.trim() === "common.cancel");
  expect(cancel).toBeTruthy();
  cancel!.click();
  await flushPromises();
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("clone");
  expect(jobs.count).toBe(1);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("status.jobCancelling");
  expect(cancel!.disabled).toBe(true);
  jobs.finished("clone");
  expect(jobs.count).toBe(0);
});

it("keeps a frontend UI job visible when jobList returns empty", async () => {
  const jobs = useJobsStore();
  jobs.started({ id: "fetch-1", title: "Fetching remotes…", message: "origin" });
  mocks.list.mockResolvedValue([]);
  jobs.openPopup({ x: 8, y: 640 });
  mount(JobsPopup, { attachTo: document.body });
  await flushPromises();
  const menu = document.querySelector('[role="dialog"]');
  expect(menu?.textContent).toContain("Fetching remotes…");
  expect(menu?.textContent).not.toContain("status.jobsEmpty");
  expect(jobs.count).toBe(1);
});

it("shows an empty state when idle and closes on Escape", async () => {
  const jobs = useJobsStore();
  jobs.openPopup({ x: 8, y: 640 });
  mount(JobsPopup, { attachTo: document.body });
  await flushPromises();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("status.jobsEmpty");
  document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await flushPromises();
  expect(jobs.popupOpen).toBe(false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("keeps reactive store rows when jobs change while open", async () => {
  const jobs = reactive(useJobsStore());
  jobs.openPopup({ x: 8, y: 640 });
  mount(JobsPopup, { attachTo: document.body });
  await flushPromises();
  jobs.started({ id: "pull", title: "Pulling origin/main…", message: "Fetching…" });
  await flushPromises();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Pulling origin/main…");
});

it("disables cancel immediately, retains it after reopen and allows retry after failure", async () => {
  const jobs = useJobsStore();
  const native = { id: "slow", title: "Slow operation", startedAt: 1, cancellable: true };
  jobs.started(native, "native");
  mocks.list.mockResolvedValue([native]);
  let reject!: (error: unknown) => void;
  mocks.cancel.mockReturnValueOnce(
    new Promise((_resolve, no) => {
      reject = no;
    }),
  );
  jobs.openPopup();
  mount(JobsPopup, { attachTo: document.body });
  await flushPromises();
  const cancelButton = () => document.querySelector<HTMLButtonElement>('[role="dialog"] button')!;
  cancelButton().click();
  await flushPromises();
  expect(cancelButton().disabled).toBe(true);
  cancelButton().click();
  expect(mocks.cancel).toHaveBeenCalledOnce();
  jobs.closePopup();
  await flushPromises();
  jobs.openPopup();
  await flushPromises();
  expect(cancelButton().disabled).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("status.jobCancelling");
  reject(new Error("IPC unavailable"));
  await flushPromises();
  expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
    title: "status.cancelFailed",
    description: "IPC unavailable",
  });
  expect(cancelButton().disabled).toBe(false);
  cancelButton().click();
  await flushPromises();
  expect(mocks.cancel).toHaveBeenCalledTimes(2);
  expect(jobs.count).toBe(1);
  jobs.finished(native.id);
  await flushPromises();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("status.jobsEmpty");
});

it("does not display a stale cancel error after the job has finished", async () => {
  const jobs = useJobsStore();
  const native = { id: "ending", title: "Ending operation", startedAt: 1, cancellable: true };
  jobs.started(native, "native");
  mocks.list.mockResolvedValue([native]);
  let reject!: (error: unknown) => void;
  mocks.cancel.mockReturnValueOnce(
    new Promise((_resolve, no) => {
      reject = no;
    }),
  );
  jobs.openPopup();
  mount(JobsPopup, { attachTo: document.body });
  await flushPromises();
  document.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click();
  jobs.finished(native.id);
  reject(new Error("job not found"));
  await flushPromises();
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(jobs.count).toBe(0);
});
