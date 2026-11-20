import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia, type Pinia } from "pinia";
import { useUpdateStore } from "./updateStore";
import UpdateCenterDialog from "@/features/updates/UpdateCenterDialog.vue";
import DialogHost from "@/components/common/DialogHost.vue";
import { closeDialog, openDialog, useDialogStack } from "@/composables/useDialog";
import { i18n } from "@/i18n";

const mocks = vi.hoisted(() => ({
  backend: {
    appInfo: vi.fn(),
    appCheckForUpdates: vi.fn(),
    appDownloadUpdate: vi.fn(),
    appInstallUpdate: vi.fn(),
  },
  listen: vi.fn(),
  unlisten: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  isTauri: () => true,
}));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

let pinia: Pinia;
let store: ReturnType<typeof useUpdateStore>;
let host: VueWrapper | undefined;

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  store = useUpdateStore();
  mocks.backend.appInfo.mockResolvedValue({ name: "gitx", version: "0.1.41" });
  mocks.backend.appCheckForUpdates.mockResolvedValue({
    currentVersion: "0.1.41",
    latestVersion: "0.1.42",
    newer: true,
    releaseUrl: "https://github.com/yifunxxx/gitx/releases/tag/v0.1.42",
    nsisUrl: "https://github.com/yifunxxx/gitx/releases/download/v0.1.42/a.exe",
    msiUrl: null,
    notes: "Update action test",
  });
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.backend.appDownloadUpdate.mockResolvedValue({ path: "/tmp/a.exe", version: "0.1.42" });
  mocks.backend.appInstallUpdate.mockResolvedValue(null);
  await store.checkForUpdates({ manual: true, quiet: true });
});

afterEach(() => {
  host?.unmount();
  host = undefined;
  for (const entry of [...useDialogStack().value]) closeDialog(false, entry.id);
  store.stopAutoChecks();
  store.$dispose();
});

it("coalesces repeated primary actions while the installer launch is pending", async () => {
  await store.downloadUpdate();
  const launch = deferred<null>();
  mocks.backend.appInstallUpdate.mockReturnValue(launch.promise);
  const first = store.primaryAction();
  const second = store.primaryAction();
  await flushPromises();
  const installCalls = mocks.backend.appInstallUpdate.mock.calls.length;
  launch.resolve(null);
  await Promise.all([first, second]);
  expect(installCalls).toBe(1);
  expect(mocks.backend.appDownloadUpdate).toHaveBeenCalledOnce();
});

it("disables the update-center action while the installer launch is pending", async () => {
  await store.downloadUpdate();
  const launch = deferred<null>();
  mocks.backend.appInstallUpdate.mockReturnValue(launch.promise);
  host = mount(DialogHost, { attachTo: document.body, global: { plugins: [pinia, i18n] } });
  void openDialog(UpdateCenterDialog);
  await flushPromises();
  const action = Array.from(document.body.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Restart and update"),
  )!;
  expect(action).toBeTruthy();
  action.click();
  await flushPromises();
  const disabledDuringLaunch = action.disabled;
  const busyDuringLaunch = action.getAttribute("aria-busy");
  const spinnerDuringLaunch = action.querySelector("svg.animate-spin[aria-hidden=true]") !== null;
  action.click();
  await flushPromises();
  const installCalls = mocks.backend.appInstallUpdate.mock.calls.length;
  launch.resolve(null);
  await flushPromises();
  expect(disabledDuringLaunch).toBe(true);
  expect(busyDuringLaunch).toBe("true");
  expect(spinnerDuringLaunch).toBe(true);
  expect(installCalls).toBe(1);
  expect(action.getAttribute("aria-busy")).toBe("false");
  expect(action.querySelector("svg.animate-spin")).toBeNull();
});

it("reports a failed progress subscription and allows the download to be retried", async () => {
  mocks.listen.mockRejectedValueOnce(new Error("progress subscription failed"));
  await expect(store.downloadUpdate()).rejects.toThrow("progress subscription failed");
  expect(store.phase).toBe("error");
  expect(store.error).toContain("progress subscription failed");
  expect(mocks.backend.appDownloadUpdate).not.toHaveBeenCalled();
  await store.downloadUpdate();
  expect(store.phase).toBe("ready");
  expect(store.error).toBeNull();
  expect(mocks.backend.appDownloadUpdate).toHaveBeenCalledOnce();
});

it("installs a ready download once during a normal primary action", async () => {
  await store.downloadUpdate();
  await store.primaryAction();
  expect(mocks.backend.appInstallUpdate).toHaveBeenCalledExactlyOnceWith({ path: "/tmp/a.exe" });
  expect(mocks.backend.appDownloadUpdate).toHaveBeenCalledOnce();
  expect(store.phase).toBe("ready");
});

it("shares one progress subscription and download while listener registration is pending", async () => {
  const registration = deferred<() => void>();
  mocks.listen.mockReturnValueOnce(registration.promise);
  const first = store.downloadUpdate();
  const second = store.downloadUpdate();
  await flushPromises();
  const registrations = mocks.listen.mock.calls.length;
  const downloadsBeforeRegistration = mocks.backend.appDownloadUpdate.mock.calls.length;
  registration.resolve(mocks.unlisten);
  expect(await Promise.all([first, second])).toEqual(["/tmp/a.exe", "/tmp/a.exe"]);
  expect(registrations).toBe(1);
  expect(downloadsBeforeRegistration).toBe(0);
  expect(mocks.backend.appDownloadUpdate).toHaveBeenCalledOnce();
});

it.each(["primary", "installAfter", "install"])(
  "shares an automatic download and launches once for repeated %s requests",
  async (entry) => {
    const download = deferred<{ path: string; version: string }>();
    mocks.backend.appDownloadUpdate.mockReturnValueOnce(download.promise);
    await store.checkForUpdates({ quiet: true });
    await flushPromises();
    expect(store.phase).toBe("downloading");
    const action = () =>
      entry === "primary"
        ? store.primaryAction()
        : entry === "installAfter"
          ? store.downloadUpdate({ installAfter: true })
          : store.installUpdate();
    const first = action();
    const second = action();
    await flushPromises();
    const downloads = mocks.backend.appDownloadUpdate.mock.calls.length;
    download.resolve({ path: "/tmp/a.exe", version: "0.1.42" });
    await Promise.all([first, second]);
    expect(downloads).toBe(1);
    expect(mocks.listen).toHaveBeenCalledOnce();
    expect(mocks.backend.appInstallUpdate).toHaveBeenCalledExactlyOnceWith({ path: "/tmp/a.exe" });
    expect(store.phase).toBe("ready");
  },
);

it("releases the install request after download failure so a primary action can retry", async () => {
  const download = deferred<{ path: string; version: string }>();
  mocks.backend.appDownloadUpdate.mockReturnValueOnce(download.promise);
  const first = store.primaryAction();
  const second = store.primaryAction();
  const attempts = Promise.allSettled([first, second]);
  await flushPromises();
  download.reject(new Error("download interrupted"));
  expect((await attempts).map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(store.phase).toBe("error");
  expect(store.error).toContain("download interrupted");
  expect(mocks.backend.appInstallUpdate).not.toHaveBeenCalled();
  await store.primaryAction();
  expect(mocks.backend.appDownloadUpdate).toHaveBeenCalledTimes(2);
  expect(mocks.backend.appInstallUpdate).toHaveBeenCalledOnce();
  expect(store.phase).toBe("ready");
  expect(store.error).toBeNull();
});

it("releases the install request after listener failure so a primary action can retry", async () => {
  mocks.listen.mockRejectedValueOnce(new Error("listener unavailable"));
  await expect(store.primaryAction()).rejects.toThrow("listener unavailable");
  expect(store.phase).toBe("error");
  expect(mocks.backend.appDownloadUpdate).not.toHaveBeenCalled();
  expect(mocks.backend.appInstallUpdate).not.toHaveBeenCalled();
  await store.primaryAction();
  expect(mocks.listen).toHaveBeenCalledTimes(2);
  expect(mocks.backend.appDownloadUpdate).toHaveBeenCalledOnce();
  expect(mocks.backend.appInstallUpdate).toHaveBeenCalledOnce();
  expect(store.error).toBeNull();
});

it("reuses the downloaded installer when a failed installation is retried", async () => {
  mocks.backend.appInstallUpdate.mockRejectedValueOnce(new Error("launch failed"));
  await expect(store.primaryAction()).rejects.toThrow("launch failed");
  expect(store.phase).toBe("error");
  expect(store.error).toContain("launch failed");
  await store.primaryAction();
  expect(mocks.backend.appDownloadUpdate).toHaveBeenCalledOnce();
  expect(mocks.backend.appInstallUpdate).toHaveBeenCalledTimes(2);
  expect(store.phase).toBe("ready");
  expect(store.error).toBeNull();
});

it("keeps the installing phase and cached download during another automatic check", async () => {
  await store.downloadUpdate();
  const launch = deferred<null>();
  mocks.backend.appInstallUpdate.mockReturnValueOnce(launch.promise);
  const installation = store.primaryAction();
  await store.checkForUpdates({ quiet: true });
  await flushPromises();
  const phaseDuringLaunch = store.phase;
  const downloads = mocks.backend.appDownloadUpdate.mock.calls.length;
  launch.resolve(null);
  await installation;
  expect(phaseDuringLaunch).toBe("installing");
  expect(downloads).toBe(1);
  expect(mocks.backend.appInstallUpdate).toHaveBeenCalledOnce();
});

it.each(["checking", "downloading"])(
  "disables and guards the update-center action while %s",
  async (phase) => {
    host = mount(DialogHost, { attachTo: document.body, global: { plugins: [pinia, i18n] } });
    void openDialog(UpdateCenterDialog);
    await flushPromises();
    const check = deferred<typeof store.latest>();
    const download = deferred<{ path: string; version: string }>();
    const info = store.latest;
    let operation: Promise<unknown>;
    if (phase === "checking") {
      mocks.backend.appCheckForUpdates.mockReturnValueOnce(check.promise);
      operation = store.checkForUpdates({ manual: true, quiet: true });
    } else {
      mocks.backend.appDownloadUpdate.mockReturnValueOnce(download.promise);
      operation = store.downloadUpdate();
    }
    await flushPromises();
    const action = Array.from(document.body.querySelectorAll('[role="dialog"] button')).at(
      -1,
    ) as HTMLButtonElement;
    const disabledWhileBusy = action.disabled;
    // Dispatch directly to also exercise the handler guard behind disabled DOM.
    action.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    check.resolve(info);
    download.resolve({ path: "/tmp/a.exe", version: "0.1.42" });
    await operation;
    await flushPromises();
    expect(disabledWhileBusy).toBe(true);
    expect(mocks.backend.appInstallUpdate).not.toHaveBeenCalled();
    expect(action.disabled).toBe(false);
  },
);

it("guards same-tick repeated clicks before the primary action publishes its store phase", async () => {
  await store.downloadUpdate();
  const completion = deferred<void>();
  const actionSpy = vi.spyOn(store, "primaryAction").mockReturnValue(completion.promise);
  host = mount(DialogHost, { attachTo: document.body, global: { plugins: [pinia, i18n] } });
  void openDialog(UpdateCenterDialog);
  await flushPromises();
  const action = Array.from(document.body.querySelectorAll('[role="dialog"] button')).at(
    -1,
  ) as HTMLButtonElement;
  action.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  action.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushPromises();
  const disabledDuringAction = action.disabled;
  completion.resolve();
  await flushPromises();
  expect(actionSpy).toHaveBeenCalledOnce();
  expect(disabledDuringAction).toBe(true);
  expect(action.disabled).toBe(false);
});

it("downloads and installs the newly checked version after an older automatic download finishes", async () => {
  const previous = deferred<{ path: string; version: string }>();
  mocks.backend.appDownloadUpdate
    .mockReturnValueOnce(previous.promise)
    .mockResolvedValueOnce({ path: "/tmp/new.exe", version: "0.1.43" });
  await store.checkForUpdates({ quiet: true });
  await flushPromises();
  mocks.backend.appCheckForUpdates.mockResolvedValueOnce({
    ...store.latest,
    latestVersion: "0.1.43",
    nsisUrl: "https://github.com/yifunxxx/gitx/releases/download/v0.1.43/new.exe",
  });
  await store.checkForUpdates({ quiet: true });
  const installation = store.primaryAction();
  await flushPromises();
  expect(mocks.backend.appDownloadUpdate).toHaveBeenCalledTimes(1);
  previous.resolve({ path: "/tmp/old.exe", version: "0.1.42" });
  await installation;
  expect(mocks.backend.appDownloadUpdate.mock.calls).toEqual([
    [
      {
        url: "https://github.com/yifunxxx/gitx/releases/download/v0.1.42/a.exe",
        version: "0.1.42",
      },
    ],
    [
      {
        url: "https://github.com/yifunxxx/gitx/releases/download/v0.1.43/new.exe",
        version: "0.1.43",
      },
    ],
  ]);
  expect(mocks.backend.appInstallUpdate).toHaveBeenCalledExactlyOnceWith({ path: "/tmp/new.exe" });
  expect(store.downloadedPath).toBe("/tmp/new.exe");
});

it("does not install a previous primary-action target after a check switches releases", async () => {
  const previous = deferred<{ path: string; version: string }>();
  mocks.backend.appDownloadUpdate.mockReturnValueOnce(previous.promise);
  const installation = store.primaryAction();
  await flushPromises();
  mocks.backend.appCheckForUpdates.mockResolvedValueOnce({
    ...store.latest,
    latestVersion: "0.1.43",
    nsisUrl: "https://github.com/yifunxxx/gitx/releases/download/v0.1.43/new.exe",
  });
  await store.checkForUpdates({ manual: true, quiet: true });
  previous.resolve({ path: "/tmp/old.exe", version: "0.1.42" });
  await installation;
  expect(mocks.backend.appInstallUpdate).not.toHaveBeenCalled();
  expect(store.downloadedPath).toBeNull();
  expect(store.phase).toBe("available");
});

it.each(["ignore", "stop"])(
  "disposes a late progress subscription and skips downloading after %s",
  async (kind) => {
    const registration = deferred<() => void>();
    const cleanup = vi.fn();
    mocks.listen.mockReturnValueOnce(registration.promise);
    const download = store.downloadUpdate();
    await flushPromises();
    expect(mocks.listen).toHaveBeenCalledOnce();
    if (kind === "ignore") store.ignoreThisVersion();
    else store.stopAutoChecks();
    registration.resolve(cleanup);
    expect(await download).toBeNull();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(mocks.backend.appDownloadUpdate).not.toHaveBeenCalled();
    expect(mocks.backend.appInstallUpdate).not.toHaveBeenCalled();
  },
);

it("keeps ignored download progress from returning after a late native progress event", async () => {
  const download = deferred<{ path: string; version: string }>();
  mocks.backend.appDownloadUpdate.mockReturnValueOnce(download.promise);
  const pending = store.downloadUpdate();
  await flushPromises();
  store.ignoreThisVersion();
  mocks.listen.mock.calls[0]![1]({
    payload: { version: "0.1.42", downloaded: 50, total: 100 },
  });
  expect(store.phase).toBe("idle");
  expect(store.downloadProgress).toBeNull();
  download.resolve({ path: "/tmp/ignored.exe", version: "0.1.42" });
  expect(await pending).toBeNull();
  expect(store.downloadedPath).toBeNull();
});

it.each(["ignore", "stop"])(
  "cancels a newer release queued behind an older download after %s",
  async (kind) => {
    const previous = deferred<{ path: string; version: string }>();
    mocks.backend.appDownloadUpdate
      .mockReturnValueOnce(previous.promise)
      .mockResolvedValueOnce({ path: "/tmp/new.exe", version: "0.1.43" });
    await store.checkForUpdates({ quiet: true });
    await flushPromises();
    mocks.backend.appCheckForUpdates.mockResolvedValueOnce({
      ...store.latest,
      latestVersion: "0.1.43",
      nsisUrl: "https://github.com/yifunxxx/gitx/releases/download/v0.1.43/new.exe",
    });
    await store.checkForUpdates({ quiet: true });
    const installation = store.primaryAction();
    await flushPromises();
    if (kind === "ignore") store.ignoreThisVersion();
    else store.stopAutoChecks();
    previous.resolve({ path: "/tmp/old.exe", version: "0.1.42" });
    await installation;
    await flushPromises();
    expect(mocks.backend.appDownloadUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.backend.appInstallUpdate).not.toHaveBeenCalled();
    expect(store.downloadedPath).toBeNull();
  },
);
