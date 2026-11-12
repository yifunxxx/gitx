import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import JobsPopup from "./JobsPopup.vue";
import { useJobsStore } from "@/stores/jobsStore";

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
  jobs.started({
    id: "clone",
    title: "Cloning repository…",
    message: "Receiving objects",
    percent: 45,
    cancellable: true,
  });
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
  const menu = document.querySelector('[role="menu"]');
  expect(menu?.textContent).toContain("Cloning repository…");
  expect(menu?.textContent).toContain("Receiving objects");
  expect(menu?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("45");
  const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (item) => item.textContent?.trim() === "common.cancel",
  );
  expect(cancel).toBeTruthy();
  cancel!.click();
  await flushPromises();
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("clone");
  expect(jobs.count).toBe(0);
});

it("shows an empty state when idle and closes on Escape", async () => {
  const jobs = useJobsStore();
  jobs.openPopup({ x: 8, y: 640 });
  mount(JobsPopup, { attachTo: document.body });
  await flushPromises();
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("status.jobsEmpty");
  document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await flushPromises();
  expect(jobs.popupOpen).toBe(false);
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("keeps reactive store rows when jobs change while open", async () => {
  const jobs = reactive(useJobsStore());
  jobs.openPopup({ x: 8, y: 640 });
  mount(JobsPopup, { attachTo: document.body });
  await flushPromises();
  jobs.started({ id: "pull", title: "Pulling origin/main…", message: "Fetching…" });
  await flushPromises();
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("Pulling origin/main…");
});
