import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { reactive, shallowRef } from "vue";
import BranchesPane from "./BranchesPane.vue";
import BranchesPopup from "./BranchesPopup.vue";
import { useBranchesStore } from "@/stores/branchesStore";
import type { RefEntry } from "@/lib/backend";

const mocks = vi.hoisted(() => ({
  ws: {} as { repoPath: string; repoId: string; gitDir: string; isRepo: boolean; generation: number; navigationToken(): number },
  backend: {
    refsList: vi.fn(), remoteList: vi.fn(), branchCreate: vi.fn(), branchRename: vi.fn(),
    branchDelete: vi.fn(), branchRestore: vi.fn(), branchUpdate: vi.fn(), remoteDeleteBranch: vi.fn(),
  },
  changes: { refresh: vi.fn() },
  log: { filters: { revisions: [] }, load: vi.fn() },
  rewrite: { merge: vi.fn(), rebase: vi.fn() },
  sync: { pull: vi.fn() },
  dialog: vi.fn(), toast: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => ({ settings: { git: {} } }) }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => mocks.log }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("@/stores/syncStore", () => ({ useSyncStore: () => mocks.sync }));
vi.mock("@/actions", () => ({ runAction: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/composables/useDialog", () => ({
  openDialog: mocks.dialog, useDialogState: () => shallowRef(null),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const topic: RefEntry = {
  name: "topic", fullName: "refs/heads/topic", kind: "localBranch", sha: "a".repeat(40),
  upstream: null, ahead: 0, behind: 0, isHead: false, isFavorite: false,
  subject: "", committerTime: 0, peeledSha: null,
};
const actions = [
  { name: "create", label: "branches.newBranchFrom", backend: "branchCreate", result: { name: "next", checkout: true, force: false } },
  { name: "rename", label: "branches.rename", backend: "branchRename", result: { newName: "next", unsetUpstream: false } },
  { name: "delete", label: "branches.delete", backend: "branchDelete", result: true },
] as const;
let pinia: ReturnType<typeof createPinia>;
let wrapper: ReturnType<typeof shallowMount> | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  mocks.ws = reactive({ repoPath: "A", repoId: "A", gitDir: "A/.git", isRepo: true, generation: 0,
    navigationToken() { return this.generation; },
  });
  mocks.backend.refsList.mockResolvedValue({ local: [topic], remote: [], tags: [], recent: [], current: "main", detached: false });
  mocks.backend.remoteList.mockResolvedValue([]);
  mocks.backend.branchDelete.mockResolvedValue({ sha: topic.sha });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined;
  disposePinia(pinia);
  vi.unstubAllGlobals();
});
function navigate(kind: string) {
  if (kind === "unmount") { wrapper!.unmount(); wrapper = undefined; return; }
  ++mocks.ws.generation;
  if (kind === "repository") { mocks.ws.repoPath = mocks.ws.repoId = "B"; mocks.ws.gitDir = "B/.git"; }
}
async function openMenu(component: typeof BranchesPane | typeof BranchesPopup, name = "topic") {
  useBranchesStore().popupOpen = true;
  wrapper = shallowMount(component, { global: { stubs: {
    VirtualList: false,
    ContextMenuSurface: { props: ["open"], template: '<div v-if="open" data-menu><slot /></div>' },
  } } });
  await flushPromises();
  await wrapper.get(`button[aria-label="${name}"]`).trigger("contextmenu");
  expect(wrapper.find("[data-menu]").exists()).toBe(true);
  mocks.backend.refsList.mockClear();
  mocks.backend.remoteList.mockClear();
}
async function choose(label: string) {
  await wrapper!.get("[data-menu]").findAll("button").find((button) => button.text() === label)!.trigger("click");
  await flushPromises();
}

describe.each([["pane", BranchesPane], ["popup", BranchesPopup]] as const)("%s branch actions", (_, component) => {
  it.each(actions)("keeps a normal $name on its original repository", async (action) => {
    mocks.dialog.mockResolvedValue(action.result);
    await openMenu(component);
    await choose(action.label);
    expect(mocks.backend[action.backend]).toHaveBeenCalledOnce();
    expect(mocks.backend[action.backend].mock.calls[0]![0]).toMatchObject({ path: "A" });
    expect(mocks.toast).toHaveBeenCalledOnce();
    expect(mocks.log.load).toHaveBeenCalledWith(true);
  });

  describe.each(["repository", "navigation", "unmount"])("after %s invalidation", (kind) => {
    it.each(actions)("does not execute an old $name dialog result", async (action) => {
      const gate = deferred<unknown>();
      mocks.dialog.mockReturnValue(gate.promise);
      await openMenu(component);
      await choose(action.label);
      expect(mocks.dialog).toHaveBeenCalledOnce();
      navigate(kind);
      gate.resolve(action.result);
      await flushPromises();
      expect(mocks.backend[action.backend]).not.toHaveBeenCalled();
      expect(mocks.toast).not.toHaveBeenCalled();
      expect(mocks.changes.refresh).not.toHaveBeenCalled();
    });
  });

  it("closes a menu when a new navigation starts on the same path", async () => {
    await openMenu(component);
    navigate("navigation");
    await flushPromises();
    expect(wrapper!.find("[data-menu]").exists()).toBe(false);
  });

  it.each(["success", "failure"])("ignores late rename %s after leaving its repository", async (outcome) => {
    const gate = deferred<void>();
    mocks.dialog.mockResolvedValue(actions[1].result);
    mocks.backend.branchRename.mockReturnValue(gate.promise);
    await openMenu(component);
    await choose(actions[1].label);
    expect(mocks.backend.branchRename).toHaveBeenCalledWith(expect.objectContaining({ path: "A" }));
    navigate("repository");
    if (outcome === "success") gate.resolve(); else gate.reject(new Error("old repository failed"));
    await flushPromises();
    expect(mocks.backend.refsList).not.toHaveBeenCalled();
    expect(mocks.changes.refresh).not.toHaveBeenCalled();
    expect(mocks.log.load).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("stops the remaining refresh chain after navigation during status refresh", async () => {
    const gate = deferred<void>();
    mocks.dialog.mockResolvedValue(actions[1].result);
    mocks.changes.refresh.mockReturnValue(gate.promise);
    await openMenu(component);
    await choose(actions[1].label);
    expect(mocks.changes.refresh).toHaveBeenCalledOnce();
    mocks.backend.refsList.mockClear();
    navigate("navigation");
    gate.resolve();
    await flushPromises();
    expect(mocks.log.load).not.toHaveBeenCalled();
    expect(mocks.backend.refsList).not.toHaveBeenCalled();
  });

  it.each(["merge", "rebase", "checkoutAndRebase"])("ignores a late %s completion after navigation", async (kind) => {
    const gate = deferred<void>();
    const operation = kind === "merge" ? mocks.rewrite.merge : mocks.rewrite.rebase;
    operation.mockReturnValue(gate.promise);
    await openMenu(component);
    await choose(kind === "merge" ? "branches.mergeIntoCurrent" : kind === "rebase" ? "branches.rebaseOnto" : "branches.checkoutAndRebase");
    expect(operation).toHaveBeenCalledOnce();
    navigate("navigation");
    // A newly opened popup belongs to the new navigation, not the old action.
    useBranchesStore().popupOpen = true;
    gate.resolve();
    await flushPromises();
    expect(mocks.changes.refresh).not.toHaveBeenCalled();
    expect(mocks.log.load).not.toHaveBeenCalled();
    expect(useBranchesStore().popupOpen).toBe(true);
  });
});

it.each(["normal", "navigation", "unmount"])("handles a remote branch deletion with %s ownership", async (kind) => {
  const gate = deferred<boolean>();
  mocks.dialog.mockReturnValue(gate.promise);
  mocks.backend.refsList.mockResolvedValue({ local: [], remote: [{ ...topic, kind: "remoteBranch", name: "origin/topic", fullName: "refs/remotes/origin/topic" }], tags: [], recent: [], current: "main", detached: false });
  await openMenu(BranchesPane, "origin/topic");
  await choose("branches.delete");
  if (kind !== "normal") navigate(kind);
  gate.resolve(true);
  await flushPromises();
  if (kind === "normal") {
    expect(mocks.backend.remoteDeleteBranch).toHaveBeenCalledWith({ path: "A", remote: "origin", branch: "topic" });
    expect(mocks.toast).toHaveBeenCalledOnce();
  } else {
    expect(mocks.backend.remoteDeleteBranch).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  }
});

it.each(["branchCreate", "branchRename", "branchDelete", "branchRestore", "branchUpdate"] as const)(
  "does not start a new repository read when %s finishes after same-path navigation", async (method) => {
    const gate = deferred<{ sha: string }>();
    mocks.backend[method].mockReturnValue(gate.promise);
    const store = useBranchesStore();
    const pending = method === "branchCreate" ? store.createBranch("next")
      : method === "branchRename" ? store.renameBranch("topic", "next", false)
      : method === "branchDelete" ? store.deleteBranch("topic", false)
      : method === "branchRestore" ? store.restoreBranch("topic", topic.sha)
      : store.updateBranch("topic", "origin/topic");
    ++mocks.ws.generation;
    gate.resolve({ sha: topic.sha });
    await pending;
    expect(mocks.backend.refsList).not.toHaveBeenCalled();
    expect(mocks.backend.remoteList).not.toHaveBeenCalled();
  },
);
