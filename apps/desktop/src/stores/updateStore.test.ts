import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useUpdateStore } from "./updateStore";

const backend = vi.hoisted(() => ({
  appInfo: vi.fn(),
  appCheckForUpdates: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/backend", () => ({ getBackend: () => backend }));
vi.mock("@/composables/useToast", () => ({ toast }));
vi.mock("@/lib/utils", () => ({ isTauri: () => false }));

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  setActivePinia(createPinia());
  backend.appInfo.mockResolvedValue({ name: "gitx", version: "0.1.25" });
  backend.appCheckForUpdates.mockResolvedValue({
    currentVersion: "0.1.25",
    latestVersion: "0.1.26",
    newer: true,
    releaseUrl: "https://github.com/yifunxxx/gitx/releases/tag/v0.1.26",
    nsisUrl: "https://example.test/setup.exe",
    msiUrl: null,
  });
});
afterEach(() => {
  useUpdateStore().stopAutoChecks();
});

it("toasts when a newer release is found manually", async () => {
  const store = useUpdateStore();
  const info = await store.checkForUpdates({ manual: true });
  expect(info?.newer).toBe(true);
  expect(toast).toHaveBeenCalledOnce();
  expect(toast.mock.calls[0]![0].title).toContain("0.1.26");
});

it("reports up to date on a manual check without a newer release", async () => {
  backend.appCheckForUpdates.mockResolvedValueOnce({
    currentVersion: "0.1.26",
    latestVersion: "0.1.26",
    newer: false,
    releaseUrl: "https://github.com/yifunxxx/gitx/releases/tag/v0.1.26",
    nsisUrl: null,
    msiUrl: null,
  });
  const store = useUpdateStore();
  await store.checkForUpdates({ manual: true });
  expect(toast.mock.calls[0]![0].title).toContain("up to date");
});

it("skips auto toast after the same newer version was dismissed", async () => {
  localStorage.setItem("gitx.update.dismissedVersion", "0.1.26");
  const store = useUpdateStore();
  await store.checkForUpdates({ quiet: false });
  expect(toast).not.toHaveBeenCalled();
});
