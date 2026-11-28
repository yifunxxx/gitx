import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import CommitToolWindow from "./CommitToolWindow.vue";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { createWorkspaceOpen, isWorkspaceOpening } from "@/composables/useWorkspaceOpen";

const m = vi.hoisted(() => ({
  vcsEnable: vi.fn(),
  workspaceOpen: vi.fn(),
  workspaceRecent: vi.fn(),
  appOpenNewWindow: vi.fn(),
  pick: vi.fn(),
  refresh: vi.fn(),
  load: vi.fn(),
  branches: vi.fn(),
  toast: vi.fn(),
  errors: vi.fn(),
  choose: vi.fn(),
  changes: {} as any,
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("@/lib/backend", () => ({ getBackend: () => m }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => m.changes }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => ({ load: m.load }) }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({ refresh: m.branches }) }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => ({ refreshOpState: vi.fn() }) }));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => ({}) }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({}) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/composables/useOpenProjectChoice", () => ({
  chooseOpenProjectTarget: m.choose,
}));
vi.mock("@/actions", () => ({ runAction: vi.fn() }));
vi.mock("@/lib/utils", async (original) => ({
  ...(await original<object>()),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: m.pick }));

enableAutoUnmount(afterEach);
const cleanup: Array<() => void> = [];
afterEach(async () => {
  for (const release of cleanup.splice(0)) release();
  await flushPromises();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  cleanup.push(() => resolve(undefined as T));
  return { promise, resolve, reject };
}
const result = (path: string, isRepo = true) => ({
  path,
  isRepo,
  gitDir: isRepo ? `${path}/.git` : null,
  toplevel: isRepo ? path : null,
});
function panel() {
  return shallowMount(CommitToolWindow, {
    global: {
      config: { errorHandler: m.errors },
      stubs: {
        Button: { template: "<button><slot /></button>" },
        EmptyState: { template: "<section><slot /></section>" },
        Tip: { template: "<div><slot /></div>" },
      },
    },
  });
}
const enableButton = (host: ReturnType<typeof panel>) =>
  host.findAll("button").find((button) => button.text() === "empty.enableVcs")!;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  setActivePinia(createPinia());
  useWorkspaceStore().folderPath = "folder";
  useLayoutStore().commitControlsHidden = true;
  m.changes = reactive({
    selectedPaths: [],
    checkedPaths: [],
    unversioned: [],
    stagingMode: false,
    loading: false,
    error: null,
    snapshot: null,
    refresh: m.refresh,
  });
  m.vcsEnable.mockImplementation(async ({ path }) => result(path));
  m.workspaceOpen.mockImplementation(async ({ path }) => result(path, false));
  m.appOpenNewWindow.mockResolvedValue(null);
  m.choose.mockResolvedValue("here");
  m.workspaceRecent.mockResolvedValue({ paths: [] });
});

it("shows pending state and prevents repeated clicks and other open entry points", async () => {
  const enabling = deferred<ReturnType<typeof result>>();
  m.vcsEnable.mockReturnValue(enabling.promise);
  const host = panel();
  const button = enableButton(host);
  await button.trigger("click");
  await button.trigger("click");
  expect(m.vcsEnable).toHaveBeenCalledExactlyOnceWith({ path: "folder", initialBranch: "main" });
  expect(button.attributes("disabled")).toBeDefined();
  expect(host.get('[role="status"]').text()).toContain("common.loading");
  expect(isWorkspaceOpening()).toBe(true);
  await createWorkspaceOpen((key) => key).openFolder();
  expect(m.pick).not.toHaveBeenCalled();
  enabling.resolve(result("folder"));
  await flushPromises();
  expect(isWorkspaceOpening()).toBe(false);
  expect(m.errors).not.toHaveBeenCalled();
});

it("uses the shared first reads and keeps progress until they finish", async () => {
  const reading = deferred<void>();
  m.refresh.mockReturnValue(reading.promise);
  const host = panel();
  await enableButton(host).trigger("click");
  await flushPromises();
  expect(useWorkspaceStore().isRepo).toBe(true);
  expect(m.refresh).toHaveBeenCalledOnce();
  expect(m.load).toHaveBeenCalledExactlyOnceWith(true, false, { taskOwned: true });
  expect(m.branches).toHaveBeenCalledOnce();
  expect(isWorkspaceOpening()).toBe(true);
  reading.resolve();
  await flushPromises();
  expect(isWorkspaceOpening()).toBe(false);
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({
    title: "welcome.repoCreated",
    description: "folder",
  });
});

it.each(["new folder", "folder"])(
  "drops obsolete completion after navigation to %s",
  async (path) => {
    const enabling = deferred<ReturnType<typeof result>>();
    m.vcsEnable.mockReturnValue(enabling.promise);
    const host = panel();
    await enableButton(host).trigger("click");
    await useWorkspaceStore().openFolder(path);
    enabling.resolve(result("folder"));
    await flushPromises();
    expect(useWorkspaceStore().folderPath).toBe(path);
    expect(useWorkspaceStore().isRepo).toBe(false);
    expect(m.toast).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.load).not.toHaveBeenCalled();
  },
);

it("reports initialization failure and lets the button retry", async () => {
  m.vcsEnable.mockRejectedValueOnce({ message: "Permission denied" });
  const host = panel();
  await enableButton(host).trigger("click");
  await flushPromises();
  expect(m.errors).not.toHaveBeenCalled();
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({ title: "Permission denied" });
  expect(enableButton(host).attributes("disabled")).toBeUndefined();
  await enableButton(host).trigger("click");
  await flushPromises();
  expect(m.vcsEnable).toHaveBeenCalledTimes(2);
  expect(useWorkspaceStore().isRepo).toBe(true);
});

it("disables the panel entry while another picker is open and releases it on cancel", async () => {
  const picker = deferred<string | null>();
  m.pick.mockReturnValue(picker.promise);
  const host = panel();
  const opening = createWorkspaceOpen((key) => key).openFolder();
  await flushPromises();
  const button = host.findAll("button").find((item) => item.attributes("aria-busy") === "true");
  expect(button).toBeDefined();
  expect(button!.attributes("disabled")).toBeDefined();
  await button!.trigger("click");
  expect(m.vcsEnable).not.toHaveBeenCalled();
  picker.resolve(null);
  await opening;
  await flushPromises();
  expect(enableButton(host).attributes("disabled")).toBeUndefined();
  expect(host.find('[role="status"]').exists()).toBe(false);
});

it("ignores a retired initialization failure while a newer panel initialization is pending", async () => {
  const old = deferred<ReturnType<typeof result>>();
  const newer = deferred<ReturnType<typeof result>>();
  m.vcsEnable.mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
  const host = panel();
  await enableButton(host).trigger("click");
  await useWorkspaceStore().openFolder("new folder");
  await flushPromises();
  await enableButton(host).trigger("click");
  old.reject(new Error("Retired error"));
  await flushPromises();
  expect(m.errors).not.toHaveBeenCalled();
  expect(m.toast).not.toHaveBeenCalled();
  expect(isWorkspaceOpening()).toBe(true);
  expect(host.get('[role="status"]').text()).toContain("common.loading");
  expect(m.vcsEnable).toHaveBeenLastCalledWith({ path: "new folder", initialBranch: "main" });
  newer.resolve(result("new folder"));
  await flushPromises();
  expect(isWorkspaceOpening()).toBe(false);
  expect(useWorkspaceStore().folderPath).toBe("new folder");
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({
    title: "welcome.repoCreated",
    description: "new folder",
  });
});

it("reports an initial-read failure as refresh failure after successful initialization", async () => {
  m.branches.mockRejectedValueOnce(new Error("Branches could not be read"));
  const host = panel();
  await enableButton(host).trigger("click");
  await flushPromises();
  expect(m.errors).not.toHaveBeenCalled();
  expect(useWorkspaceStore().isRepo).toBe(true);
  expect(m.vcsEnable).toHaveBeenCalledOnce();
  expect(m.toast).toHaveBeenLastCalledWith({
    title: "rewrite.refreshFailed",
    description: "Branches could not be read",
  });
  expect(isWorkspaceOpening()).toBe(false);
});
