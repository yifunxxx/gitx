import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import ManageRemotesDialog from "./ManageRemotesDialog.vue";
import DialogHost from "@/components/common/DialogHost.vue";
import { closeDialog, openDialog, useDialogStack, useDialogState } from "@/composables/useDialog";

const m = vi.hoisted(() => ({
  workspace: {} as any,
  branches: {} as any,
  remoteList: vi.fn(),
  remoteAdd: vi.fn(),
  remoteEdit: vi.fn(),
  remoteRemovePreview: vi.fn(),
  remoteRemove: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => m.workspace }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => m.branches }));
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: () => ({ settings: { git: { fetchOnAddRemote: false } } }),
}));
vi.mock("@/composables/useToast", () => ({ toast: m.toast }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

enableAutoUnmount(afterEach);
const releases: Array<() => void> = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  releases.push(() => resolve(undefined as T));
  return { promise, resolve, reject };
}
const remote = (name = "origin") => ({
  name,
  fetchUrl: `https://example.invalid/${name}.git`,
  pushUrl: null,
});
const button = (host: ReturnType<typeof mount>, label: string) =>
  host.findAll("button").find((entry) => entry.text() === label)!;
async function open() {
  void openDialog(ManageRemotesDialog);
  const id = useDialogState().value!.id;
  const host = mount(ManageRemotesDialog);
  await flushPromises();
  return { host, id };
}
async function fillAdd(host: ReturnType<typeof mount>) {
  await host.get('input[placeholder="origin"]').setValue("backup");
  await host.get('input[placeholder="https://…"]').setValue("https://example.invalid/backup.git");
}
beforeEach(() => {
  vi.resetAllMocks();
  m.workspace = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    navigation: 1,
    navigationToken() {
      return this.navigation;
    },
  });
  m.branches = reactive({ refresh: vi.fn().mockResolvedValue(undefined), error: null });
  m.remoteList.mockImplementation(async () => [remote()]);
  m.remoteRemovePreview.mockResolvedValue({ trackingCount: 2 });
  m.remoteAdd.mockResolvedValue(undefined);
  m.remoteEdit.mockResolvedValue(undefined);
  m.remoteRemove.mockResolvedValue(undefined);
});
afterEach(async () => {
  while (useDialogStack().value.length) closeDialog(false);
  for (const release of releases.splice(0)) release();
  await flushPromises();
});

it("keeps the rename draft editable and submits the original remote identity", async () => {
  const { host } = await open();
  await button(host, "Edit").trigger("click");
  await host.get("tbody input").setValue("upstream");
  expect(host.findAll("tbody input")).toHaveLength(2);
  expect(button(host, "Save")).toBeDefined();
  await host.findAll("tbody input")[1]!.setValue("https://example.invalid/updated.git");
  await button(host, "Save").trigger("click");
  await flushPromises();
  expect(m.remoteEdit).toHaveBeenCalledExactlyOnceWith({
    path: "A",
    name: "origin",
    newName: "upstream",
    url: "https://example.invalid/updated.git",
    pushUrl: null,
  });
});

it("cancels a draft without changing the listed remote", async () => {
  const { host } = await open();
  await button(host, "Edit").trigger("click");
  await host.findAll("tbody input")[1]!.setValue("https://example.invalid/draft.git");
  expect(button(host, "Cancel")).toBeDefined();
  await button(host, "Cancel").trigger("click");
  expect(host.get("tbody").text()).toContain("https://example.invalid/origin.git");
  expect(host.get("tbody").text()).not.toContain("draft.git");
  expect(m.remoteEdit).not.toHaveBeenCalled();
});

it("shows initial loading and blocks writes until the list is available", async () => {
  const read = deferred<any[]>();
  m.remoteList.mockReturnValueOnce(read.promise);
  const { host } = await open();
  expect(host.get('[role="status"]').text()).toContain("Loading");
  expect(button(host, "+").attributes("disabled")).toBeDefined();
  read.resolve([remote()]);
  await flushPromises();
  expect(host.find('[role="status"]').exists()).toBe(false);
  expect(host.text()).toContain("origin.git");
});

it("locks add while pending and retains the submitted values", async () => {
  const adding = deferred<void>();
  m.remoteAdd.mockReturnValue(adding.promise);
  const { host } = await open();
  await fillAdd(host);
  await button(host, "+").trigger("click");
  await button(host, "+").trigger("click");
  expect(m.remoteAdd).toHaveBeenCalledExactlyOnceWith({
    path: "A",
    name: "backup",
    url: "https://example.invalid/backup.git",
    fetchAfter: false,
  });
  expect(host.get('input[placeholder="origin"]').attributes("disabled")).toBeDefined();
  adding.resolve();
  await flushPromises();
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({ title: "Remote backup added" });
});

it.each(["different repository", "same path navigation"])(
  "invalidates removal confirmation after %s",
  async (kind) => {
    const { host, id } = await open();
    await button(host, "−").trigger("click");
    await flushPromises();
    const confirmId = useDialogState().value!.id;
    expect(confirmId).not.toBe(id);
    if (kind === "different repository") {
      m.workspace.repoPath = "B";
      m.workspace.repoId = "B";
    } else {
      m.workspace.navigation++;
    }
    closeDialog(true, confirmId);
    await flushPromises();
    expect(m.remoteRemove).not.toHaveBeenCalled();
    expect(m.toast).not.toHaveBeenCalled();
  },
);

it("does not open a late removal confirmation after unmount", async () => {
  const preview = deferred<{ trackingCount: number }>();
  m.remoteRemovePreview.mockReturnValue(preview.promise);
  const { host, id } = await open();
  await button(host, "−").trigger("click");
  host.unmount();
  closeDialog(false, id);
  void openDialog({ name: "UnrelatedDialog", render: () => null });
  const other = useDialogState().value!.id;
  preview.resolve({ trackingCount: 2 });
  await flushPromises();
  expect(useDialogState().value?.id).toBe(other);
  expect(useDialogStack().value).toHaveLength(1);
  expect(m.remoteRemove).not.toHaveBeenCalled();
});

it("does not publish late write feedback into a replaced dialog", async () => {
  const adding = deferred<void>();
  m.remoteAdd.mockReturnValue(adding.promise);
  const { host, id } = await open();
  await fillAdd(host);
  await button(host, "+").trigger("click");
  closeDialog(false, id);
  void openDialog({ name: "OtherDialog", render: () => null });
  const other = useDialogState().value!.id;
  adding.resolve();
  await flushPromises();
  expect(m.toast).not.toHaveBeenCalled();
  expect(m.remoteList).toHaveBeenCalledOnce();
  expect(m.branches.refresh).not.toHaveBeenCalled();
  expect(useDialogState().value?.id).toBe(other);
});

it("shows a failed initial read and retries without writing", async () => {
  m.remoteList.mockRejectedValueOnce(new Error("Config unreadable"));
  const { host } = await open();
  expect(host.get('[role="alert"]').text()).toContain("Config unreadable");
  expect(button(host, "+").attributes("disabled")).toBeDefined();
  await button(host, "Retry").trigger("click");
  await flushPromises();
  expect(host.find('[role="alert"]').exists()).toBe(false);
  expect(host.text()).toContain("origin.git");
  expect(m.remoteAdd).not.toHaveBeenCalled();
});

it("preserves a rejected add draft and permits a single retry", async () => {
  m.remoteAdd.mockRejectedValueOnce({ message: "Permission denied" });
  const { host } = await open();
  await fillAdd(host);
  await button(host, "+").trigger("click");
  await flushPromises();
  expect(host.get('[role="alert"]').text()).toContain("Permission denied");
  expect((host.get('input[placeholder="origin"]').element as HTMLInputElement).value).toBe(
    "backup",
  );
  expect(m.toast).not.toHaveBeenCalled();
  await button(host, "+").trigger("click");
  await flushPromises();
  expect(m.remoteAdd).toHaveBeenCalledTimes(2);
  expect(m.toast).toHaveBeenCalledOnce();
  expect(host.find('[role="alert"]').exists()).toBe(false);
});

it("preserves an edit after failure and blocks duplicate saves", async () => {
  const save = deferred<void>();
  m.remoteEdit.mockReturnValueOnce(save.promise);
  const { host } = await open();
  await button(host, "Edit").trigger("click");
  await host.get("tbody input").setValue("renamed");
  await button(host, "Save").trigger("click");
  await button(host, "Save").trigger("click");
  expect(m.remoteEdit).toHaveBeenCalledOnce();
  expect(button(host, "Close").attributes("disabled")).toBeDefined();
  await host.trigger("keydown", { key: "Escape" });
  expect(useDialogStack().value).toHaveLength(1);
  save.reject(new Error("Edit denied"));
  await flushPromises();
  expect(host.get('[role="alert"]').text()).toContain("Edit denied");
  expect((host.get("tbody input").element as HTMLInputElement).value).toBe("renamed");
  await button(host, "Save").trigger("click");
  await flushPromises();
  expect(m.remoteEdit).toHaveBeenCalledTimes(2);
});

it("distinguishes a successful add from failed list refresh and retries only reads", async () => {
  const { host } = await open();
  m.remoteList.mockRejectedValueOnce(new Error("Refresh unavailable"));
  await fillAdd(host);
  await button(host, "+").trigger("click");
  await flushPromises();
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({ title: "Remote backup added" });
  expect(host.get('[role="alert"]').text()).toContain("Remote backup added, but refresh failed");
  expect(host.get('[role="alert"]').text()).toContain("Refresh unavailable");
  expect((host.get('input[placeholder="origin"]').element as HTMLInputElement).value).toBe("");
  expect(button(host, "+").attributes("disabled")).toBeDefined();
  await button(host, "Retry").trigger("click");
  await flushPromises();
  expect(m.remoteAdd).toHaveBeenCalledOnce();
  expect(host.find('[role="alert"]').exists()).toBe(false);
});

it("reports a store-managed branch refresh failure after a successful edit", async () => {
  const { host } = await open();
  m.branches.refresh.mockImplementationOnce(async () => {
    m.branches.error = "References unavailable";
  });
  await button(host, "Edit").trigger("click");
  await button(host, "Save").trigger("click");
  await flushPromises();
  expect(m.remoteEdit).toHaveBeenCalledOnce();
  expect(host.findAll("tbody input")).toHaveLength(0);
  expect(host.get('[role="alert"]').text()).toContain("Remote origin saved, but refresh failed");
  expect(host.get('[role="alert"]').text()).toContain("References unavailable");
  m.branches.refresh.mockImplementationOnce(async () => {
    m.branches.error = null;
  });
  await button(host, "Retry").trigger("click");
  await flushPromises();
  expect(m.remoteEdit).toHaveBeenCalledOnce();
  expect(host.find('[role="alert"]').exists()).toBe(false);
});

it("deduplicates removal previews, handles cancellation, and removes the captured remote", async () => {
  const preview = deferred<{ trackingCount: number }>();
  m.remoteRemovePreview.mockReturnValueOnce(preview.promise);
  const { host, id } = await open();
  await button(host, "−").trigger("click");
  await button(host, "−").trigger("click");
  expect(m.remoteRemovePreview).toHaveBeenCalledExactlyOnceWith({ path: "A", name: "origin" });
  preview.resolve({ trackingCount: 2 });
  await flushPromises();
  closeDialog(false);
  await flushPromises();
  expect(useDialogState().value?.id).toBe(id);
  expect(m.remoteRemove).not.toHaveBeenCalled();
  await button(host, "−").trigger("click");
  await flushPromises();
  closeDialog(true);
  await flushPromises();
  expect(m.remoteRemove).toHaveBeenCalledExactlyOnceWith({ path: "A", name: "origin" });
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({ title: "Removed origin" });
});

it.each(["preview", "write"])("reports removal %s failure and permits retry", async (failure) => {
  if (failure === "preview")
    m.remoteRemovePreview.mockRejectedValueOnce(new Error("Preview denied"));
  else m.remoteRemove.mockRejectedValueOnce(new Error("Remove denied"));
  const { host } = await open();
  await button(host, "−").trigger("click");
  await flushPromises();
  if (failure === "write") {
    closeDialog(true);
    await flushPromises();
  }
  expect(host.get('[role="alert"]').text()).toContain("denied");
  expect(m.toast).not.toHaveBeenCalled();
  await button(host, "−").trigger("click");
  await flushPromises();
  closeDialog(true);
  await flushPromises();
  expect(m.toast).toHaveBeenCalledExactlyOnceWith({ title: "Removed origin" });
});

it("invalidates only its own dialog and confirmation while leaving another prompt open", async () => {
  const { host } = await open();
  await button(host, "−").trigger("click");
  await flushPromises();
  void openDialog({ name: "UnrelatedPrompt", render: () => null });
  const other = useDialogState().value!.id;
  m.workspace.navigation++;
  await flushPromises();
  expect(useDialogStack().value.map((entry) => entry.id)).toEqual([other]);
  expect(m.remoteRemove).not.toHaveBeenCalled();
});

it("allows closing an initial read and ignores its late error", async () => {
  const read = deferred<any[]>();
  m.remoteList.mockReturnValueOnce(read.promise);
  const { host, id } = await open();
  await button(host, "Close").trigger("click");
  expect(useDialogStack().value.some((entry) => entry.id === id)).toBe(false);
  read.reject(new Error("Obsolete read failure"));
  await flushPromises();
  expect(host.find('[role="alert"]').exists()).toBe(false);
  expect(m.toast).not.toHaveBeenCalled();
});

it("cancels a nested removal confirmation with Escape without dismissing its parent", async () => {
  const host = mount(DialogHost, { attachTo: document.body });
  void openDialog(ManageRemotesDialog);
  const parentId = useDialogState().value!.id;
  await flushPromises();
  await button(host, "−").trigger("click");
  await flushPromises();
  const childId = useDialogState().value!.id;
  expect(childId).not.toBe(parentId);
  await host.get(`[data-dialog-host="${childId}"] [role="dialog"]`).trigger("keydown", {
    key: "Escape",
  });
  await flushPromises();
  expect(useDialogState().value?.id).toBe(parentId);
  expect(m.remoteRemove).not.toHaveBeenCalled();
  expect(button(host, "−").attributes("disabled")).toBeUndefined();
  await host.get('[role="dialog"]').trigger("keydown", { key: "Escape", isComposing: true });
  expect(useDialogState().value?.id).toBe(parentId);
  await host.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
  await flushPromises();
  expect(useDialogStack().value).toHaveLength(0);
});
