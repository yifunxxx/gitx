import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { useUpdateStore } from "./updateStore";

const m = vi.hoisted(() => ({
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
vi.mock("@/lib/backend", () => ({ getBackend: () => m.backend }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/composables/useDialog", () => ({ openDialog: vi.fn() }));
vi.mock("@/lib/utils", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: m.listen }));
vi.mock("@/features/updates/UpdateCenterDialog.vue", () => ({ default: {} }));

const app = { name: "gitx", version: "0.1.44" };
const release = (version = "0.1.45") => ({
  currentVersion: "0.1.44",
  latestVersion: version,
  newer: true,
  releaseUrl: "https://example.invalid/releases",
  nsisUrl: "https://example.invalid/installer.exe",
  msiUrl: null,
  notes: "Controlled update check",
});
let pinia: ReturnType<typeof createPinia>;
let store: ReturnType<typeof useUpdateStore>;
const releases: Array<() => void> = [];
const operations: Promise<unknown>[] = [];
function deferred<T>(fallback: T) {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  releases.push(() => resolve(fallback));
  return { promise, resolve, reject };
}
function track<T>(promise: Promise<T>) {
  operations.push(promise.catch(() => undefined));
  return promise;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  store = useUpdateStore();
  m.backend.appInfo.mockResolvedValue(app);
  m.backend.appCheckForUpdates.mockResolvedValue(release());
  m.backend.appDownloadUpdate.mockResolvedValue({ path: "/tmp/test.exe", version: "0.1.45" });
  m.listen.mockResolvedValue(m.unlisten);
});
afterEach(async () => {
  store.stopAutoChecks();
  for (const resolve of releases.splice(0)) resolve();
  await Promise.allSettled(operations.splice(0));
  await flushPromises();
  store.stopAutoChecks();
  disposePinia(pinia);
  vi.clearAllTimers();
  vi.useRealTimers();
});
const retire = (kind: "stop" | "dispose") =>
  kind === "stop" ? store.stopAutoChecks() : store.$dispose();

it.each(["stop", "dispose"] as const)(
  "%s during version lookup prevents a later update check and cached-version write",
  async (kind) => {
    const version = deferred(app);
    m.backend.appInfo.mockReturnValueOnce(version.promise);
    const pending = track(store.checkForUpdates({ quiet: true }));
    await flushPromises();
    retire(kind);
    version.resolve(app);
    await pending;
    expect(m.backend.appCheckForUpdates).not.toHaveBeenCalled();
    expect(store.currentVersion).toBeNull();
    expect(store.checking).toBe(false);
  },
);

it.each(["stop", "dispose"] as const)(
  "%s prevents late automatic checks from downloading or reattaching a progress listener",
  async (kind) => {
    const result = deferred(release());
    m.backend.appCheckForUpdates.mockReturnValueOnce(result.promise);
    const pending = track(store.checkForUpdates({ quiet: true }));
    await flushPromises();
    retire(kind);
    result.resolve(release());
    await pending;
    await flushPromises();
    expect(m.backend.appDownloadUpdate).not.toHaveBeenCalled();
    expect(m.listen).not.toHaveBeenCalled();
    expect(store.latest).toBeNull();
    expect(store.lastCheckedAt).toBeNull();
    expect(localStorage.getItem("gitx.update.lastCheckAt")).toBeNull();
    expect(store.checking).toBe(false);
  },
);

it.each(["stop", "dispose"] as const)(
  "%s discards a late manual check error without notifying or rejecting",
  async (kind) => {
    const result = deferred(release());
    m.backend.appCheckForUpdates.mockReturnValueOnce(result.promise);
    const pending = track(store.checkForUpdates({ manual: true }));
    const settled = Promise.allSettled([pending]);
    await flushPromises();
    retire(kind);
    result.reject(new Error("Retired update check"));
    expect((await settled)[0]?.status).toBe("fulfilled");
    expect(m.toast).not.toHaveBeenCalled();
    expect(store.error).toBeNull();
    expect(store.checking).toBe(false);
  },
);

it.each(["success", "failure"])(
  "a retired check's %s cannot finish or replace a restarted pending check",
  async (outcome) => {
    const old = deferred(release());
    const fresh = deferred(release("0.1.46"));
    m.backend.appCheckForUpdates
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const previous = track(store.checkForUpdates({ manual: true }));
    await flushPromises();
    store.stopAutoChecks();
    store.startAutoChecks();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(m.backend.appCheckForUpdates).toHaveBeenCalledTimes(2);
    if (outcome === "success") old.resolve(release());
    else old.reject(new Error("Old check failed"));
    await Promise.allSettled([previous]);
    expect(store.checking).toBe(true);
    expect(store.latest).toBeNull();
    expect(m.toast).not.toHaveBeenCalled();
    fresh.resolve(release("0.1.46"));
    await flushPromises();
    expect(store.latest?.latestVersion).toBe("0.1.46");
    expect(store.checking).toBe(false);
  },
);

it("disposes timers and an established native progress listener with the store", async () => {
  store.startAutoChecks();
  await vi.advanceTimersByTimeAsync(8_000);
  expect(m.listen).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(1);
  store.$dispose();
  expect(vi.getTimerCount()).toBe(0);
  expect(m.unlisten).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  expect(m.backend.appCheckForUpdates).toHaveBeenCalledOnce();
});

it("cleans up a progress listener registered after store disposal without downloading", async () => {
  const listener = deferred(m.unlisten);
  m.listen.mockReturnValueOnce(listener.promise);
  store.latest = release();
  const download = track(store.downloadUpdate());
  await flushPromises();
  store.$dispose();
  listener.resolve(m.unlisten);
  await download;
  expect(m.unlisten).toHaveBeenCalledOnce();
  expect(m.backend.appDownloadUpdate).not.toHaveBeenCalled();
});

it("does not restart timers or issue new checks through a disposed store", async () => {
  store.$dispose();
  store.startAutoChecks();
  await store.checkForUpdates({ manual: true });
  await store.ensureCurrentVersion();
  expect(vi.getTimerCount()).toBe(0);
  expect(m.backend.appInfo).not.toHaveBeenCalled();
  expect(m.backend.appCheckForUpdates).not.toHaveBeenCalled();
});

it("restarts a cancelled same-version download after the old transfer settles", async () => {
  const old = deferred({ path: "/tmp/old.exe", version: "0.1.45" });
  m.backend.appDownloadUpdate.mockReturnValueOnce(old.promise);
  await store.checkForUpdates({ quiet: true });
  await flushPromises();
  store.stopAutoChecks();
  expect(store.phase).toBe("available");
  await store.checkForUpdates({ quiet: true });
  await flushPromises();
  expect(m.backend.appDownloadUpdate).toHaveBeenCalledOnce();
  old.resolve({ path: "/tmp/old.exe", version: "0.1.45" });
  await flushPromises();
  expect(m.backend.appDownloadUpdate).toHaveBeenCalledTimes(2);
  expect(store.downloadedPath).toBe("/tmp/test.exe");
  expect(store.phase).toBe("ready");
});

it("ignores queued progress from the prior lifecycle after a download restarts", async () => {
  store.latest = release();
  await store.downloadUpdate();
  const oldProgress = m.listen.mock.calls[0]![1];
  store.stopAutoChecks();
  store.latest = release("0.1.46");
  const transfer = deferred({ path: "/tmp/new.exe", version: "0.1.46" });
  m.backend.appDownloadUpdate.mockReturnValueOnce(transfer.promise);
  const downloading = track(store.downloadUpdate());
  await flushPromises();
  oldProgress({ payload: { version: "0.1.46", downloaded: 90, total: 100 } });
  expect(store.downloadProgress).toBeNull();
  m.listen.mock.calls[1]![1]({ payload: { version: "0.1.46", downloaded: 25, total: 100 } });
  expect(store.downloadProgress).toBe(25);
  transfer.resolve({ path: "/tmp/new.exe", version: "0.1.46" });
  await downloading;
  expect(store.phase).toBe("ready");
});

it("keeps normal manual checking, failure reporting and retry working", async () => {
  m.backend.appCheckForUpdates.mockRejectedValueOnce(new Error("Current check failed"));
  await expect(store.checkForUpdates({ manual: true })).rejects.toThrow("Current check failed");
  expect(store.checking).toBe(false);
  expect(store.error).toBe("Current check failed");
  expect(m.toast).toHaveBeenCalledOnce();
  await store.checkForUpdates({ manual: true });
  expect(store.latest?.latestVersion).toBe("0.1.45");
  expect(store.error).toBeNull();
  expect(m.backend.appDownloadUpdate).not.toHaveBeenCalled();
});
