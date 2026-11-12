import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import StatusBar from "./StatusBar.vue";
import { useJobsStore } from "@/stores/jobsStore";

vi.mock("@/lib/backend", () => ({
  getBackend: () => ({ jobList: vi.fn().mockResolvedValue([]), jobCancel: vi.fn() }),
}));
vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string, params?: { count?: number }) =>
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
  setActivePinia(createPinia());
});

it("opens and closes the jobs popup from the process indicator", async () => {
  const jobs = useJobsStore();
  jobs.started({ id: "1", title: "Busy" });
  const wrapper = mount(StatusBar);
  const button = wrapper.get('button[aria-label="status.jobsTitle"]');
  expect(button.text()).toContain("status.busy:1");
  await button.trigger("click");
  expect(jobs.popupOpen).toBe(true);
  await button.trigger("click");
  expect(jobs.popupOpen).toBe(false);
});
