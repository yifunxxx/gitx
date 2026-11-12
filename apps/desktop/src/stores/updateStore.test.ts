import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useUpdateStore } from "./updateStore";

const backend = vi.hoisted(() => ({
  appInfo: vi.fn(),
  appCheckForUpdates: vi.fn(),
  appDownloadUpdate: vi.fn(),
  appInstallUpdate: vi.fn(),
}));
const toast = vi.hoisted(() => vi.fn());
const openDialog = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/backend", () => ({ getBackend: () => backend }));
vi.mock("@/composables/useToast", () => ({ toast }));
vi.mock("@/composables/useDialog", () => ({ openDialog }));
vi.mock("@/lib/utils", () => ({ isTauri: () => false }));
vi.mock("@/features/updates/UpdateCenterDialog.vue", () => ({
  default: { name: "UpdateCenterDialog", template: "<div />" },
}));

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
    nsisUrl: "https://github.com/yifunxxx/gitx/releases/download/v0.1.26/gitx_0.1.26_x64-setup.exe",
    msiUrl: null,
    notes: "## Features\n- Update center",
  });
  backend.appDownloadUpdate.mockResolvedValue({
    path: "/tmp/gitx_0.1.26_x64-setup.exe",
    version: "0.1.26",
  });
  backend.appInstallUpdate.mockResolvedValue(null);
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
  expect(store.updateAvailable).toBe(true);
});

it("reports up to date on a manual check without a newer release", async () => {
  backend.appCheckForUpdates.mockResolvedValueOnce({
    currentVersion: "0.1.26",
    latestVersion: "0.1.26",
    newer: false,
    releaseUrl: "https://github.com/yifunxxx/gitx/releases/tag/v0.1.26",
    nsisUrl: null,
    msiUrl: null,
    notes: "",
  });
  const store = useUpdateStore();
  await store.checkForUpdates({ manual: true });
  expect(toast.mock.calls[0]![0].title).toContain("up to date");
  expect(store.updateAvailable).toBe(false);
});

it("skips toolbar/auto download after the same newer version was ignored", async () => {
  localStorage.setItem("gitx.update.dismissedVersion", "0.1.26");
  const store = useUpdateStore();
  await store.checkForUpdates({ quiet: true });
  expect(toast).not.toHaveBeenCalled();
  expect(store.updateAvailable).toBe(false);
  expect(backend.appDownloadUpdate).not.toHaveBeenCalled();
});

it("auto-downloads a newer installer for the toolbar flow", async () => {
  const store = useUpdateStore();
  await store.checkForUpdates({ quiet: true });
  expect(store.updateAvailable).toBe(true);
  await vi.waitFor(() => expect(store.phase).toBe("ready"));
  expect(backend.appDownloadUpdate).toHaveBeenCalledOnce();
  expect(store.statusText).toContain("0.1.26");
});

it("ignoreThisVersion hides the toolbar until a newer release appears", async () => {
  const store = useUpdateStore();
  await store.checkForUpdates({ quiet: true });
  await vi.waitFor(() => expect(store.phase).toBe("ready"));
  store.ignoreThisVersion();
  expect(store.updateAvailable).toBe(false);
  expect(localStorage.getItem("gitx.update.dismissedVersion")).toBe("0.1.26");
});

it("primaryAction installs a ready download", async () => {
  const store = useUpdateStore();
  await store.checkForUpdates({ quiet: true });
  await vi.waitFor(() => expect(store.phase).toBe("ready"));
  await store.primaryAction();
  expect(backend.appInstallUpdate).toHaveBeenCalledWith({
    path: "/tmp/gitx_0.1.26_x64-setup.exe",
  });
});
