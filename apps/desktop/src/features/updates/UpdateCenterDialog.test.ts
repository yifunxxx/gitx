import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import UpdateCenterDialog from "./UpdateCenterDialog.vue";
import DialogHost from "@/components/common/DialogHost.vue";
import { openDialog } from "@/composables/useDialog";
import { useUpdateStore } from "@/stores/updateStore";
import { i18n } from "@/i18n";

const backend = vi.hoisted(() => ({
  appInfo: vi.fn(),
  appCheckForUpdates: vi.fn(),
  appDownloadUpdate: vi.fn(),
  appInstallUpdate: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => backend }));
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, isTauri: () => false };
});

let pinia: Pinia;
let store: ReturnType<typeof useUpdateStore>;
let host: ReturnType<typeof mount>;

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  store = useUpdateStore();
  backend.appInfo.mockResolvedValue({ name: "gitx", version: "0.1.25" });
  backend.appCheckForUpdates.mockResolvedValue({
    currentVersion: "0.1.25",
    latestVersion: "0.1.26",
    newer: true,
    releaseUrl: "https://github.com/yifunxxx/gitx/releases/tag/v0.1.26",
    nsisUrl: "https://github.com/yifunxxx/gitx/releases/download/v0.1.26/a.exe",
    msiUrl: null,
    notes: "Release notes body",
  });
  backend.appDownloadUpdate.mockResolvedValue({ path: "/tmp/a.exe", version: "0.1.26" });
  backend.appInstallUpdate.mockResolvedValue(null);
  await store.checkForUpdates({ quiet: true });
  await vi.waitFor(() => expect(store.phase).toBe("ready"));
  host = mount(DialogHost, { attachTo: document.body, global: { plugins: [pinia, i18n] } });
  void openDialog(UpdateCenterDialog);
  await flushPromises();
});

afterEach(() => {
  host.unmount();
  store.stopAutoChecks();
  store.$dispose();
});

it("renders notes, status, and actions", () => {
  expect(document.body.textContent).toContain("Update Center");
  expect(document.body.querySelector('[data-testid="update-notes"]')?.textContent).toContain(
    "Release notes body",
  );
  expect(document.body.querySelector('[data-testid="update-status"]')?.textContent).toContain(
    "0.1.26",
  );
  expect(document.body.textContent).toContain("Ignore this version");
  expect(document.body.textContent).toContain("Open download page");
  expect(document.body.textContent).toContain("Restart and update");
});

it("ignore this version suppresses the available update", async () => {
  const ignore = Array.from(document.body.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Ignore this version"),
  );
  expect(ignore).toBeTruthy();
  ignore!.click();
  await flushPromises();
  expect(store.updateAvailable).toBe(false);
});
