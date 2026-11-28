import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import StatusBar from "./StatusBar.vue";
import { useJobsStore } from "@/stores/jobsStore";
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));

const mocks = vi.hoisted(() => ({ list: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({ jobList: mocks.list, jobCancel: mocks.cancel }),
}));
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: { count?: number }) =>
      params?.count != null ? `${key}:${params.count}` : key,
  }),
}));
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: () => ({ isRepo: false, branch: null }),
}));
vi.mock("@/stores/branchesStore", () => ({
  useBranchesStore: () => ({ openPopup: vi.fn(), hasUnfetched: false }),
}));

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.cancel.mockResolvedValue(true);
  setActivePinia(createPinia());
});

it("opens and closes the jobs popup from the process indicator", async () => {
  const jobs = useJobsStore();
  jobs.started({ id: "1", title: "Busy" });
  const wrapper = mount(StatusBar);
  const button = wrapper.get('button[aria-label="status.jobsTitle"]');
  expect(button.text()).toContain("Busy");
  await button.trigger("click");
  expect(jobs.popupOpen).toBe(true);
  await button.trigger("click");
  expect(jobs.popupOpen).toBe(false);
});

it("shows the actual operation, concurrent count and returns to idle", async () => {
  const jobs = useJobsStore();
  const wrapper = mount(StatusBar);
  const first = jobs.begin("Checking out · feature", "C:/repo");
  const second = jobs.begin("Committing", "C:/other");
  await wrapper.vm.$nextTick();
  const button = wrapper.get('button[aria-label="status.jobsTitle"]');
  expect(button.text()).toContain("Checking out · feature");
  expect(button.text()).toContain("(2)");
  expect(button.attributes("title")).toContain("C:/other");
  jobs.finished(first);
  await wrapper.vm.$nextTick();
  expect(button.text()).toContain("Committing");
  jobs.finished(second);
  await wrapper.vm.$nextTick();
  expect(button.text()).toContain("status.idle");
});

it("shows cancellation in the status indicator until completion", async () => {
  const jobs = useJobsStore();
  jobs.started({ id: "native", title: "Auto Fetch", cancellable: true }, "native");
  const wrapper = mount(StatusBar);
  await jobs.cancel("native");
  await wrapper.vm.$nextTick();
  const button = wrapper.get('button[aria-label="status.jobsTitle"]');
  expect(button.text()).toContain("Auto Fetch · status.jobCancelling");
  expect(button.attributes("title")).toContain("status.jobCancelling");
  expect(button.find("svg").exists()).toBe(true);
  jobs.finished("native");
  await wrapper.vm.$nextTick();
  expect(button.text()).toContain("status.idle");
  expect(button.find("svg").exists()).toBe(false);
});

it("distinguishes checking and unavailable process status from idle", async () => {
  const jobs = useJobsStore();
  let reject!: (error: Error) => void;
  mocks.list.mockReturnValueOnce(
    new Promise((_done, no) => {
      reject = no;
    }),
  );
  const wrapper = mount(StatusBar);
  const button = wrapper.get('button[aria-label="status.jobsTitle"]');
  await button.trigger("click");
  expect(button.text()).toContain("status.jobsLoading");
  expect(button.text()).not.toContain("status.idle");
  reject(new Error("queue unavailable"));
  await flushPromises();
  expect(button.text()).toContain("status.jobsUnavailable");
  expect(button.attributes("title")).toContain("queue unavailable");
  expect(button.find('[role="img"]').exists()).toBe(true);
  await jobs.refresh();
  await flushPromises();
  expect(button.text()).toContain("status.idle");
  expect(button.find('[role="img"]').exists()).toBe(false);
});

it("retains the running task title and indicates a failed queue refresh alongside it", async () => {
  const jobs = useJobsStore();
  jobs.started({ id: "known", title: "Known operation" }, "native");
  const wrapper = mount(StatusBar);
  mocks.list.mockRejectedValueOnce(new Error("queue unavailable"));
  await expect(jobs.refresh()).rejects.toThrow("queue unavailable");
  await flushPromises();
  const button = wrapper.get('button[aria-label="status.jobsTitle"]');
  expect(button.text()).toContain("Known operation");
  expect(button.find('[role="img"]').exists()).toBe(true);
  expect(button.attributes("title")).toContain("queue unavailable");
  jobs.finished("known");
  await flushPromises();
  expect(button.text()).toContain("status.jobsUnavailable");
  expect(button.text()).not.toContain("status.idle");
});
