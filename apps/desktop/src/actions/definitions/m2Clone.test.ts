import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import { registerM2Actions } from "./m2";
import { registerVcsActions } from "./vcs";
import { getAction, isEnabled, runAction } from "../registry";
import { closeDialog, useDialogStack } from "@/composables/useDialog";
import { useWorkspaceOpen } from "@/composables/useWorkspaceOpen";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useLayoutStore } from "@/stores/layoutStore";
import WelcomeView from "@/features/welcome/WelcomeView.vue";
import CloneDialog from "@/features/welcome/CloneDialog.vue";
import DialogHost from "@/components/common/DialogHost.vue";
import { i18n } from "@/i18n";

const m = vi.hoisted(() => ({
  cloneRun: vi.fn(),
  cloneCheckUrl: vi.fn(),
  jobCancel: vi.fn(),
  auth: vi.fn(),
  workspaceOpen: vi.fn(),
  workspaceRecent: vi.fn(),
  appOpenNewWindow: vi.fn(),
  refresh: vi.fn(),
  load: vi.fn(),
  branches: vi.fn(),
  toast: vi.fn(),
  pick: vi.fn(),
  choose: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m }));
vi.mock("@/lib/utils", async (original) => ({
  ...(await original<object>()),
  isTauri: () => false,
}));
vi.mock("@/composables/useCredentials", () => ({ handleAuthFailure: m.auth }));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("@/composables/useConfirm", () => ({ promptDialog: m.pick }));
vi.mock("@/composables/useOpenProjectChoice", () => ({
  chooseOpenProjectTarget: m.choose,
}));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: m.refresh }) }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => ({ load: m.load }) }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => ({ refresh: m.branches }) }));
vi.mock("@/actions", async () => await import("../registry"));

const result = (path: string) => ({ path, isRepo: true, gitDir: `${path}/.git`, toplevel: path });
const tasks: Promise<unknown>[] = [];
const releases: Array<() => void> = [];
function track<T>(task: Promise<T>) {
  tasks.push(task);
  void task.catch(() => {});
  return task;
}
function deferred<T>(cleanup: T) {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  releases.push(() => resolve(cleanup));
  return { promise, resolve, reject };
}
const ctx = () => ({
  repoIds: [],
  selection: {},
  source: "menu" as const,
  place: "Welcome",
  folderPath: useWorkspaceStore().folderPath,
});
const run = (id = "Git.Clone") => track(runAction(id, ctx()));
let host: ReturnType<typeof mount>;
let entry: ReturnType<typeof useWorkspaceOpen>;
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  const pinia = createPinia();
  setActivePinia(pinia);
  m.workspaceOpen.mockImplementation(async ({ path }) => result(path));
  m.workspaceRecent.mockResolvedValue({ paths: [] });
  m.appOpenNewWindow.mockResolvedValue(null);
  m.choose.mockResolvedValue("here");
  m.cloneRun.mockResolvedValue({ path: "clone" });
  m.jobCancel.mockResolvedValue(true);
  m.cloneCheckUrl.mockResolvedValue(true);
  registerM2Actions();
  registerVcsActions();
  host = mount(
    defineComponent({
      components: { WelcomeView, DialogHost },
      setup() {
        entry = useWorkspaceOpen();
        return { workspace: useWorkspaceStore() };
      },
      template: '<WelcomeView v-if="!workspace.folderPath"/><DialogHost/>',
    }),
    { attachTo: document.body, global: { plugins: [pinia, i18n] } },
  );
  useLayoutStore().activeBottomTab = "console";
});
afterEach(async () => {
  host.unmount();
  while (useDialogStack().value.length) closeDialog(null);
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(tasks.splice(0));
  await flushPromises();
});
async function startClone(openAfter = true) {
  const task = run();
  await flushPromises();
  const dialog = host.findComponent(CloneDialog);
  await dialog.get("#clone-url").setValue("https://example.test/repo.git");
  await dialog.get("#clone-directory").setValue("clone");
  if (!openAfter) await dialog.findAll('input[type="checkbox"]')[1]!.setValue(false);
  await dialog.get("form").trigger("submit");
  await flushPromises();
  return { task, dialog };
}

it("opens one clone dialog across Welcome clicks and the action registry", async () => {
  const cloneButton = host
    .findComponent(WelcomeView)
    .findAll("button")
    .find((button) => button.text() === i18n.global.t("welcome.clone"))!;
  await cloneButton.trigger("click");
  await cloneButton.trigger("click");
  const duplicate = run();
  await flushPromises();
  expect(useDialogStack().value).toHaveLength(1);
  expect(isEnabled(getAction("Git.Clone")!, ctx())).toBe(false);
  closeDialog(null);
  await duplicate;
  await flushPromises();
  expect(isEnabled(getAction("Git.Clone")!, ctx())).toBe(true);
  expect(m.cloneRun).not.toHaveBeenCalled();
});

it("allows navigation during cloning without auto-opening the completed old clone", async () => {
  const cloning = deferred({ path: "clone" });
  m.cloneRun.mockReturnValue(cloning.promise);
  const { task } = await startClone();
  expect(entry.pending.value).toBe(false);
  expect(isEnabled(getAction("File.OpenFolder")!, ctx())).toBe(true);
  m.pick.mockResolvedValueOnce("newer");
  await run("File.OpenFolder");
  m.refresh.mockClear();
  m.load.mockClear();
  m.branches.mockClear();
  useLayoutStore().activeBottomTab = "console";
  cloning.resolve({ path: "clone" });
  await task;
  expect(useWorkspaceStore().folderPath).toBe("newer");
  expect(m.workspaceOpen).toHaveBeenCalledExactlyOnceWith({ path: "newer" });
  expect(m.jobCancel).not.toHaveBeenCalled();
  expect(m.refresh).not.toHaveBeenCalled();
  expect(useLayoutStore().activeBottomTab).toBe("console");
  expect(m.toast).toHaveBeenCalledWith({
    title: i18n.global.t("clone.done"),
    description: "clone",
  });
});

it("shares post-clone opening progress and starts all initial reads before releasing it", async () => {
  const opening = deferred(result("clone"));
  const reading = deferred<void>(undefined);
  m.workspaceOpen.mockReturnValueOnce(opening.promise);
  m.refresh.mockReturnValueOnce(reading.promise);
  const { task } = await startClone();
  expect(entry.pending.value).toBe(true);
  expect(entry.pendingPath.value).toBe("clone");
  expect(host.findComponent(WelcomeView).get('[role="status"]').text()).toContain("clone");
  await entry.openRecent("duplicate");
  await run("File.OpenFolder");
  expect(m.workspaceOpen).toHaveBeenCalledExactlyOnceWith({ path: "clone" });
  expect(m.pick).not.toHaveBeenCalled();
  opening.resolve(result("clone"));
  await flushPromises();
  expect(host.findComponent(WelcomeView).exists()).toBe(false);
  expect(entry.pending.value).toBe(true);
  expect(m.refresh).toHaveBeenCalledOnce();
  expect(m.load).toHaveBeenCalledExactlyOnceWith(true);
  expect(m.branches).toHaveBeenCalledOnce();
  reading.resolve();
  await task;
  expect(entry.pending.value).toBe(false);
  expect(m.cloneRun).toHaveBeenCalledOnce();
});

it("reports opening failure after clone without repeating the successful clone", async () => {
  m.workspaceOpen.mockRejectedValueOnce({ message: "Cloned directory unavailable" });
  const { task } = await startClone();
  await expect(task).resolves.toBeUndefined();
  expect(entry.pending.value).toBe(false);
  expect(host.findComponent(WelcomeView).get('[role="alert"]').text()).toBe(
    "Cloned directory unavailable",
  );
  expect(m.cloneRun).toHaveBeenCalledOnce();
  await entry.openRecent("clone");
  expect(useWorkspaceStore().folderPath).toBe("clone");
  expect(entry.error.value).toBeNull();
  expect(m.cloneRun).toHaveBeenCalledOnce();
});

it("does not switch panels or refresh when post-clone opening loses navigation", async () => {
  const opening = deferred(result("clone"));
  m.workspaceOpen.mockReturnValueOnce(opening.promise);
  const { task } = await startClone();
  await useWorkspaceStore().openFolder("newer");
  opening.resolve(result("clone"));
  await task;
  expect(useWorkspaceStore().folderPath).toBe("newer");
  expect(m.refresh).not.toHaveBeenCalled();
  expect(m.load).not.toHaveBeenCalled();
  expect(m.branches).not.toHaveBeenCalled();
  expect(useLayoutStore().activeBottomTab).toBe("console");
});

it("does not interrupt a newer directory picker when cloning completes", async () => {
  const cloning = deferred({ path: "clone" });
  const picker = deferred<string | null>(null);
  m.cloneRun.mockReturnValueOnce(cloning.promise);
  m.pick.mockReturnValueOnce(picker.promise);
  const { task } = await startClone();
  const picking = run("File.OpenFolder");
  await flushPromises();
  cloning.resolve({ path: "clone" });
  await task;
  expect(m.workspaceOpen).not.toHaveBeenCalled();
  expect(entry.pending.value).toBe(true);
  picker.resolve("chosen");
  await picking;
  expect(useWorkspaceStore().folderPath).toBe("chosen");
});

it("retains cancellation and open-after opt-out without navigating", async () => {
  const cloning = deferred({ path: "clone" });
  m.cloneRun.mockReturnValueOnce(cloning.promise);
  const { task, dialog } = await startClone();
  await dialog
    .findAll("button")
    .find((button) => button.text() === i18n.global.t("clone.cancel"))!
    .trigger("click");
  cloning.reject({ code: "cancelled" });
  await task;
  expect(m.jobCancel).toHaveBeenCalledExactlyOnceWith(m.cloneRun.mock.calls[0]![0].jobId);
  expect(m.workspaceOpen).not.toHaveBeenCalled();
  expect(isEnabled(getAction("Git.Clone")!, ctx())).toBe(true);
  const optedOut = await startClone(false);
  await optedOut.task;
  expect(m.workspaceOpen).not.toHaveBeenCalled();
  expect(entry.pending.value).toBe(false);
});

it("keeps a clone failure in its dialog and retries with a new job before opening", async () => {
  m.cloneRun.mockRejectedValueOnce({ message: "Clone connection failed" });
  m.auth.mockResolvedValue(false);
  const { task, dialog } = await startClone();
  const dialogId = useDialogStack().value[0]!.id;
  expect(dialog.get('[role="alert"]').text()).toBe("Clone connection failed");
  expect(m.workspaceOpen).not.toHaveBeenCalled();
  expect(entry.pending.value).toBe(false);
  expect(isEnabled(getAction("Git.Clone")!, ctx())).toBe(false);
  await dialog.get("form").trigger("submit");
  await task;
  expect(m.cloneRun).toHaveBeenCalledTimes(2);
  expect(m.cloneRun.mock.calls[1]![0].jobId).not.toBe(m.cloneRun.mock.calls[0]![0].jobId);
  expect(useDialogStack().value.some((item) => item.id === dialogId)).toBe(false);
  expect(m.workspaceOpen).toHaveBeenCalledExactlyOnceWith({ path: "clone" });
  expect(isEnabled(getAction("Git.Clone")!, ctx())).toBe(true);
});

it("does not auto-open after the same folder is deliberately reopened during cloning", async () => {
  await useWorkspaceStore().openFolder("same");
  const cloning = deferred({ path: "clone" });
  m.cloneRun.mockReturnValueOnce(cloning.promise);
  const { task } = await startClone();
  await useWorkspaceStore().openFolder("same");
  cloning.resolve({ path: "clone" });
  await task;
  expect(useWorkspaceStore().folderPath).toBe("same");
  expect(m.workspaceOpen.mock.calls).toEqual([[{ path: "same" }], [{ path: "same" }]]);
  expect(m.refresh).not.toHaveBeenCalled();
});

it("cancels an unmounted clone and ignores its late completion without navigating", async () => {
  const cloning = deferred({ path: "clone" });
  m.cloneRun.mockReturnValueOnce(cloning.promise);
  const { task } = await startClone();
  host.unmount();
  await task;
  expect(m.jobCancel).toHaveBeenCalledExactlyOnceWith(m.cloneRun.mock.calls[0]![0].jobId);
  cloning.resolve({ path: "clone" });
  await flushPromises();
  expect(useDialogStack().value).toHaveLength(0);
  expect(m.workspaceOpen).not.toHaveBeenCalled();
  expect(m.toast).not.toHaveBeenCalled();
  expect(isEnabled(getAction("Git.Clone")!, ctx())).toBe(true);
});

it("does not clear a newer opening or report an obsolete post-clone failure", async () => {
  const old = deferred(result("clone"));
  const newer = deferred(result("newer"));
  m.workspaceOpen.mockReturnValueOnce(old.promise);
  const { task } = await startClone();
  await useWorkspaceStore().openFolder("external");
  m.workspaceOpen.mockReturnValueOnce(newer.promise);
  const latest = track(entry.openRecent("newer"));
  m.toast.mockClear();
  old.reject(new Error("Obsolete opening failure"));
  await task;
  expect(entry.pending.value).toBe(true);
  expect(entry.pendingPath.value).toBe("newer");
  expect(entry.error.value).toBeNull();
  expect(m.toast).not.toHaveBeenCalled();
  newer.resolve(result("newer"));
  await latest;
  expect(useWorkspaceStore().folderPath).toBe("newer");
  expect(entry.pending.value).toBe(false);
});

it("does not open a clone dialog while another entry is opening a workspace", async () => {
  const opening = deferred(result("folder"));
  m.workspaceOpen.mockReturnValueOnce(opening.promise);
  const first = track(entry.openRecent("folder"));
  await run();
  expect(useDialogStack().value).toHaveLength(0);
  expect(m.cloneRun).not.toHaveBeenCalled();
  expect(isEnabled(getAction("Git.Clone")!, ctx())).toBe(false);
  opening.resolve(result("folder"));
  await first;
  expect(isEnabled(getAction("Git.Clone")!, ctx())).toBe(true);
});
