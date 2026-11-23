import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import DialogHost from "@/components/common/DialogHost.vue";
import { closeDialog, openDialog, useDialogStack } from "@/composables/useDialog";
import { withBackendActivity } from "@/lib/backend/activity";
import { useJobsStore } from "@/stores/jobsStore";
import { i18n } from "@/i18n";
import CreateTagDialog from "./CreateTagDialog.vue";

const mocks = vi.hoisted(() => ({
  ws: {} as { repoPath: string; repoId: string; isRepo: boolean; generation: number; navigationToken(): number },
  branches: { remotes: [{ name: "origin" }] },
  create: vi.fn(), push: vi.fn(), toast: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => mocks.branches }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/backend", () => ({
  getBackend: () => withBackendActivity({ tagCreate: mocks.create, tagPush: mocks.push }),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let pinia: ReturnType<typeof createPinia>;
let host: ReturnType<typeof mount>;
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia(); setActivePinia(pinia);
  i18n.global.locale.value = "en";
  mocks.ws = reactive({ repoPath: "A", repoId: "A", isRepo: true, generation: 0,
    navigationToken() { return this.generation; },
  });
  mocks.branches.remotes = [{ name: "origin" }];
  mocks.create.mockResolvedValue(null); mocks.push.mockResolvedValue(null);
  host = mount(DialogHost, { attachTo: document.body, global: { plugins: [pinia, i18n] } });
});
afterEach(() => { host.unmount(); disposePinia(pinia); });
async function fixture(push = false) {
  const result = openDialog(CreateTagDialog, { target: "topic" });
  await flushPromises();
  const view = host.getComponent(CreateTagDialog);
  const id = useDialogStack().value.at(-1)!.id;
  await view.get('input[placeholder="Tag name"]').setValue(" v1 ");
  await view.get("textarea").setValue(" note ");
  if (push) await view.findAll('input[type="checkbox"]')[1]!.setValue(true);
  return { view, result, id };
}
const button = (view: Awaited<ReturnType<typeof fixture>>["view"], label: string) => view.findAll("button").find(b => b.text() === label)!;

it("creates one tag with trimmed values on the captured repository", async () => {
  const { view, result } = await fixture();
  await button(view, "Create").trigger("click");
  await flushPromises();
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ path: "A", name: "v1", target: "topic", message: "note", force: false, pushRemote: null });
  expect(mocks.push).not.toHaveBeenCalled();
  expect(await result).toBe(true);
});

it.each(["repository", "navigation", "identity", "non-repository"])("closes and invalidates an unsubmitted tag after %s changes", async (kind) => {
  const { view, id } = await fixture();
  if (kind === "repository") mocks.ws.repoPath = "B";
  if (kind === "navigation") ++mocks.ws.generation;
  if (kind === "identity") mocks.ws.repoId = "replacement";
  if (kind === "non-repository") mocks.ws.isRepo = false;
  await button(view, "Create").trigger("click");
  await flushPromises();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(useDialogStack().value.some(d => d.id === id)).toBe(false);
});

it("blocks repeated clicks, input edits and Escape while writing and tracks one queue task", async () => {
  const pending = deferred<null>(); mocks.create.mockReturnValue(pending.promise);
  const jobs = useJobsStore();
  const { view, result } = await fixture();
  await button(view, "Create").trigger("click");
  await button(view, "Create").trigger("click");
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(jobs.count).toBe(1);
  expect(jobs.running[0]).toMatchObject({ message: "A" });
  expect(view.get('input[placeholder="Tag name"]').attributes("disabled")).toBeDefined();
  expect(view.get('[role="status"]').text()).toContain("Creating");
  await button(view, "Cancel").trigger("click");
  await view.get("textarea").trigger("keydown", { key: "Escape" });
  expect(useDialogStack().value).toHaveLength(1);
  pending.resolve(null); await flushPromises();
  expect(await result).toBe(true); expect(jobs.count).toBe(0);
});

it("keeps errors visible and permits a deliberate retry", async () => {
  mocks.create.mockRejectedValueOnce(new Error("tag locked"));
  const { view, result } = await fixture();
  await button(view, "Create").trigger("click"); await flushPromises();
  expect(view.get('[role="alert"]').text()).toContain("tag locked");
  expect(button(view, "Create").attributes("disabled")).toBeUndefined();
  await button(view, "Create").trigger("click"); await flushPromises();
  expect(mocks.create).toHaveBeenCalledTimes(2); expect(await result).toBe(true);
});

it.each(["success", "error"])("ignores a late create %s after the dialog is replaced", async (outcome) => {
  const pending = deferred<null>(); mocks.create.mockReturnValue(pending.promise);
  const jobs = useJobsStore();
  const { view, id } = await fixture(true);
  await button(view, "Create").trigger("click");
  closeDialog(false, id);
  const nextResult = openDialog({ template: '<div data-replacement>Replacement</div>' });
  await flushPromises();
  const nextId = useDialogStack().value.at(-1)!.id;
  if (outcome === "success") pending.resolve(null); else pending.reject(new Error("old failure"));
  await flushPromises();
  expect(useDialogStack().value.map(d => d.id)).toEqual([nextId]);
  expect(mocks.toast).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
  expect(jobs.count).toBe(0);
  closeDialog(null, nextId); await nextResult;
});

it("does not start a remote push if navigation invalidated local creation", async () => {
  const pending = deferred<null>(); mocks.create.mockReturnValue(pending.promise);
  const jobs = useJobsStore();
  const { view } = await fixture(true);
  await button(view, "Create").trigger("click");
  ++mocks.ws.generation; await flushPromises();
  expect(jobs.count).toBe(1);
  pending.resolve(null); await flushPromises();
  expect(mocks.push).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled();
  expect(jobs.count).toBe(0); expect(useDialogStack().value).toHaveLength(0);
});

it("creates locally before pushing and retries only the failed push", async () => {
  const pending = deferred<null>(); mocks.push.mockReturnValueOnce(pending.promise);
  const jobs = useJobsStore();
  const { view, result } = await fixture(true);
  await button(view, "Create").trigger("click"); await flushPromises();
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ pushRemote: null }));
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith({ path: "A", name: "v1", remote: "origin" });
  expect(jobs.count).toBe(1);
  pending.reject(new Error("remote denied")); await flushPromises();
  expect(view.get('[role="alert"]').text()).toContain("remote denied");
  expect(view.text()).toContain("created locally");
  expect(view.get('input[placeholder="Tag name"]').attributes("disabled")).toBeDefined();
  await button(view, "Retry push").trigger("click"); await flushPromises();
  expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.push).toHaveBeenCalledTimes(2);
  expect(await result).toBe(true); expect(jobs.count).toBe(0);
});

it("keeps its successful name snapshot if the model changes during the request", async () => {
  const pending = deferred<null>(); mocks.create.mockReturnValue(pending.promise);
  const { view } = await fixture();
  await button(view, "Create").trigger("click");
  // Programmatic input also exercises snapshot stability beyond native disabled controls.
  await view.get('input[placeholder="Tag name"]').setValue("other");
  pending.resolve(null); await flushPromises();
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Tag v1 created" }));
});

it("reports local success when closing after a failed push without recreating the tag", async () => {
  mocks.push.mockRejectedValueOnce(new Error("offline"));
  const { view, result } = await fixture(true);
  await button(view, "Create").trigger("click"); await flushPromises();
  await button(view, "Close").trigger("click");
  expect(await result).toBe(true);
  expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.push).toHaveBeenCalledOnce();
});

it("pins a push retry to the original tag and remote", async () => {
  mocks.push.mockRejectedValueOnce(new Error("offline"));
  const { view, result } = await fixture(true);
  await button(view, "Create").trigger("click"); await flushPromises();
  mocks.branches.remotes = [{ name: "new-remote" }];
  await view.get('input[placeholder="Tag name"]').setValue("other");
  await button(view, "Retry push").trigger("click"); await flushPromises();
  expect(mocks.push.mock.calls).toEqual([
    [{ path: "A", name: "v1", remote: "origin" }],
    [{ path: "A", name: "v1", remote: "origin" }],
  ]);
  expect(await result).toBe(true);
});

it("does not mistake a disappeared remote for successful creation and push", async () => {
  const { view } = await fixture(true);
  mocks.branches.remotes = [];
  await button(view, "Create").trigger("click"); await flushPromises();
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
  expect(view.get('[role="alert"]').text()).toContain("Configure a remote");
});

it("finishes an already started push without closing a replacement dialog", async () => {
  const pending = deferred<null>(); mocks.push.mockReturnValue(pending.promise);
  const jobs = useJobsStore();
  const { view } = await fixture(true);
  await button(view, "Create").trigger("click"); await flushPromises();
  expect(mocks.push).toHaveBeenCalledOnce();
  ++mocks.ws.generation; await flushPromises();
  const other = openDialog({ template: '<div>Other</div>' });
  await flushPromises();
  const id = useDialogStack().value.at(-1)!.id;
  pending.resolve(null); await flushPromises();
  expect(jobs.count).toBe(0); expect(mocks.toast).not.toHaveBeenCalled();
  expect(useDialogStack().value.map(d => d.id)).toEqual([id]);
  closeDialog(null, id); await other;
});
