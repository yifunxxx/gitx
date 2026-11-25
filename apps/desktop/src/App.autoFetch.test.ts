import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import App from "./App.vue";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { useJobsStore } from "@/stores/jobsStore";

const m = vi.hoisted(() => ({
  settings: {} as any,
  fetch: vi.fn(),
  refs: vi.fn(),
  remotes: vi.fn(),
  open: vi.fn(),
  auth: vi.fn(),
  toast: vi.fn(),
  append: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    workspaceOpen: m.open,
    workspaceRecent: async () => ({ paths: [] }),
    gitDetect: async () => ({ path: "git", version: "test" }),
    appStartupOpenPath: async () => null,
    fetchRun: m.fetch,
    refsList: m.refs,
    remoteList: m.remotes,
  }),
}));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => m.settings }));
vi.mock("@/stores/consoleStore", () => ({ useConsoleStore: () => ({ append: m.append }) }));
vi.mock("@/stores/updateStore", () => ({
  useUpdateStore: () => ({ startAutoChecks() {}, stopAutoChecks() {} }),
}));
vi.mock("@/composables/useRepositoryRefresh", () => ({ useRepositoryRefresh() {} }));
vi.mock("@/composables/useAppEvents", () => ({ useAppEvents() {} }));
vi.mock("@/composables/useWindowTitle", () => ({ useWindowTitle() {} }));
vi.mock("@/composables/useCredentials", () => ({ handleAuthFailure: m.auth }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/actions/registry", () => ({ listActions: () => [] }));
vi.mock("@/actions", async () => ({ ...(await import("@/actions/keymap")), runAction: vi.fn() }));

enableAutoUnmount(afterEach);
let pinia: ReturnType<typeof createPinia>;
const minute = 60_000;
const remote = { name: "origin", fetchUrl: "https://example.invalid/repo", pushUrl: null };
const summary = {
  remote: "all",
  newBranches: 1,
  updatedBranches: 0,
  newTags: 0,
  pruned: 0,
  message: "Fetched",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  m.settings = reactive({ settings: { git: { autoFetchMinutes: 1 } }, load: async () => {} });
  m.open.mockImplementation(async ({ path }) => ({
    path,
    isRepo: true,
    toplevel: path,
    gitDir: `${path}/.git`,
    roots: [],
  }));
  m.fetch.mockResolvedValue(summary);
  m.refs.mockResolvedValue({ local: [], remote: [], tags: [], current: "main", recent: [] });
  m.remotes.mockResolvedValue([remote]);
  await useWorkspaceStore().openFolder("A");
  useBranchesStore().remotes = [remote];
});
afterEach(() => {
  disposePinia(pinia);
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function start() {
  const wrapper = shallowMount(App, { global: { plugins: [pinia] } });
  await flushPromises();
  m.append.mockClear();
  return wrapper;
}

it("automatically fetches the active repository after the configured interval", async () => {
  const wrapper = await start();
  await vi.advanceTimersByTimeAsync(minute - 1);
  expect(m.fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(m.fetch).toHaveBeenCalledExactlyOnceWith({
    path: "A",
    remote: null,
    prune: true,
    background: true,
  });
  expect(useBranchesStore().lastFetchAt).not.toBeNull();
  expect(m.refs).toHaveBeenCalledOnce();
  wrapper.unmount();
  await vi.advanceTimersByTimeAsync(2 * minute);
  expect(m.fetch).toHaveBeenCalledOnce();
});

it("keeps automatic authentication failures out of the credential dialog", async () => {
  m.fetch.mockRejectedValue({ code: "authRequired", message: "Authentication failed" });
  await start();
  await vi.advanceTimersByTimeAsync(minute);
  expect(m.fetch).toHaveBeenCalledOnce();
  expect(m.auth).not.toHaveBeenCalled();
  expect(m.toast).toHaveBeenCalledOnce();
  expect(m.toast.mock.calls[0]![0].action).toEqual(
    expect.objectContaining({ onClick: expect.any(Function) }),
  );
});

it("does not fetch while disabled", async () => {
  m.settings.settings.git.autoFetchMinutes = 0;
  await start();
  await vi.advanceTimersByTimeAsync(10 * minute);
  expect(m.fetch).not.toHaveBeenCalled();
});

it("defers while a foreground job is active and runs once when it ends", async () => {
  const jobs = useJobsStore();
  const id = jobs.begin("Commit", "A");
  await start();
  await vi.advanceTimersByTimeAsync(3 * minute);
  expect(m.fetch).not.toHaveBeenCalled();
  jobs.finished(id);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(1);
  expect(m.fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(minute - 2);
  expect(m.fetch).toHaveBeenCalledOnce();
});

it.each(["hidden", "offline"])(
  "defers %s windows and does not replay missed intervals",
  async (mode) => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const online = vi.spyOn(navigator, "onLine", "get");
    if (mode === "hidden") visibility.mockReturnValue("hidden");
    else online.mockReturnValue(false);
    await start();
    await vi.advanceTimersByTimeAsync(5 * minute);
    expect(m.fetch).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    online.mockReturnValue(true);
    if (mode === "hidden") document.dispatchEvent(new Event("visibilitychange"));
    else window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(1);
    expect(m.fetch).toHaveBeenCalledOnce();
  },
);

it("does not overlap a slow fetch or immediately retry after it completes", async () => {
  const pending = deferred<typeof summary>();
  m.fetch.mockReturnValueOnce(pending.promise);
  await start();
  await vi.advanceTimersByTimeAsync(5 * minute);
  expect(m.fetch).toHaveBeenCalledOnce();
  pending.resolve(summary);
  await flushPromises();
  await vi.advanceTimersByTimeAsync(minute - 1);
  expect(m.fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(m.fetch).toHaveBeenCalledTimes(2);
});

it("reschedules interval changes and disabling clears pending timers", async () => {
  await start();
  await vi.advanceTimersByTimeAsync(30_000);
  m.settings.settings.git.autoFetchMinutes = 2;
  await vi.advanceTimersByTimeAsync(119_999);
  expect(m.fetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(m.fetch).toHaveBeenCalledOnce();
  m.settings.settings.git.autoFetchMinutes = 0;
  await vi.advanceTimersByTimeAsync(20 * minute);
  expect(m.fetch).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["switch", "reopen", "disable", "unmount"])(
  "discards late fetch feedback after %s",
  async (change) => {
    const pending = deferred<typeof summary>();
    m.fetch.mockReturnValueOnce(pending.promise);
    const wrapper = await start();
    await vi.advanceTimersByTimeAsync(minute);
    if (change === "switch") await useWorkspaceStore().openFolder("B");
    if (change === "reopen") await useWorkspaceStore().openFolder("A");
    if (change === "disable") m.settings.settings.git.autoFetchMinutes = 0;
    if (change === "unmount") wrapper.unmount();
    pending.resolve(summary);
    await flushPromises();
    expect(useBranchesStore().lastFetchAt).toBeNull();
    expect(m.refs).not.toHaveBeenCalled();
    expect(m.toast).not.toHaveBeenCalled();
    expect(useBranchesStore().fetching).toBe(false);
    if (change === "unmount" || change === "disable") expect(vi.getTimerCount()).toBe(0);
  },
);

it("logs failures and shows one notice per streak, with an explicit manual retry", async () => {
  m.fetch.mockRejectedValue({ code: "networkError", message: "offline remote" });
  await start();
  await vi.advanceTimersByTimeAsync(2 * minute);
  expect(m.toast).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2 * minute);
  expect(m.toast).toHaveBeenCalledOnce();
  expect(m.append).toHaveBeenCalledTimes(4);
  m.fetch.mockResolvedValue(summary);
  m.toast.mock.calls[0]![0].action.onClick();
  await flushPromises();
  expect(m.fetch.mock.calls.at(-1)![0].background).toBe(false);
  expect(useJobsStore().count).toBe(0);
});

it("does not notify for foreground preemption or retry a stale notice in another repository", async () => {
  m.fetch.mockRejectedValueOnce({ code: "cancelled", message: "write took priority" });
  m.fetch.mockRejectedValue({ code: "authRequired", message: "Authentication failed" });
  await start();
  await vi.advanceTimersByTimeAsync(minute);
  expect(m.toast).not.toHaveBeenCalled();
  expect(m.append).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(minute);
  const action = m.toast.mock.calls[0]![0].action;
  await useWorkspaceStore().openFolder("B");
  action.onClick();
  await flushPromises();
  expect(m.fetch).toHaveBeenCalledTimes(2);
  expect(m.auth).not.toHaveBeenCalled();
});

it("preserves interactive authentication for an explicitly requested fetch", async () => {
  m.fetch.mockRejectedValueOnce({ code: "authRequired", message: "Authentication failed" });
  m.auth.mockResolvedValue(true);
  await useBranchesStore().fetch();
  expect(m.auth).toHaveBeenCalledOnce();
  expect(m.fetch).toHaveBeenCalledTimes(2);
  expect(useJobsStore().count).toBe(0);
});

it.each(["no remote", "non repository"])("does no network work with %s", async (mode) => {
  if (mode === "no remote") useBranchesStore().remotes = [];
  else useWorkspaceStore().isRepo = false;
  await start();
  await vi.advanceTimersByTimeAsync(5 * minute);
  expect(m.fetch).not.toHaveBeenCalled();
});

it("waits a full interval after a successful manual fetch", async () => {
  await start();
  await vi.advanceTimersByTimeAsync(30_000);
  await useBranchesStore().fetch();
  await vi.advanceTimersByTimeAsync(minute - 1);
  expect(m.fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(m.fetch).toHaveBeenCalledTimes(2);
});
