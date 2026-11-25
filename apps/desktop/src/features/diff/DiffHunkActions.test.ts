import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { reactive } from "vue";
import { useDiffStore, type DiffTab } from "@/stores/diffStore";
import { useChangesStore } from "@/stores/changesStore";
import type { DiffFileResult } from "@/lib/backend";
import DiffViewer from "./DiffViewer.vue";
import CodeMirrorDiff from "./CodeMirrorDiff.vue";
import type { HunkAction } from "./hunkActions";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  layout: {} as any,
  confirm: vi.fn(),
  prompt: vi.fn(),
  stageHunks: vi.fn(),
  unstageHunks: vi.fn(),
  revertHunks: vi.fn(),
  stageLines: vi.fn(),
  diffFile: vi.fn(),
  statusGet: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => ({ settings: { stagingMode: true } }) }));
vi.mock("@/composables/useConfirm", () => ({
  confirmDialog: mocks.confirm,
  promptDialog: mocks.prompt,
}));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const result = (): DiffFileResult => ({
  path: "file.txt",
  leftLabel: "Staged",
  rightLabel: "Local",
  leftText: "old\n",
  rightText: "new\n",
  binary: false,
  tooLarge: false,
  encoding: "utf-8",
  eolMismatch: false,
  hunks: [
    {
      index: 0,
      header: "@@ -1,1 +1,1 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: ["-old", "+new"],
    },
  ],
});
let pinia: Pinia, diffs: ReturnType<typeof useDiffStore>;
let wrapper: ReturnType<typeof shallowMount>;
beforeEach(async () => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  mocks.workspace = reactive({
    repoId: "A",
    repoPath: "C:/A",
    token: 0,
    isRepo: true,
    setBranch: vi.fn(),
    navigationToken() {
      return this.token;
    },
  });
  mocks.layout = reactive({ activeEditorKind: "diff", bottomOpen: false, bottomMaximized: false });
  mocks.diffFile.mockImplementation(async () => result());
  mocks.confirm.mockResolvedValue(true);
  mocks.statusGet.mockResolvedValue({ repoId: "A", version: 1, files: [], branch: null });
  const changes = useChangesStore();
  const realRefresh = changes.refresh;
  mocks.refresh.mockImplementation(() => realRefresh());
  vi.spyOn(changes, "refresh").mockImplementation(mocks.refresh);
  diffs = useDiffStore();
  await diffs.openFileDiff("file.txt");
  wrapper = shallowMount(DiffViewer, {
    props: { tabId: diffs.activeId! },
    global: {
      stubs: {
        Tip: { template: "<div><slot /></div>" },
        Button: { template: "<button><slot /></button>" },
      },
    },
  });
  await flushPromises();
  mocks.diffFile.mockClear();
});
afterEach(() => {
  wrapper.unmount();
  disposePinia(pinia);
});
function pane() {
  return wrapper.findAllComponents(CodeMirrorDiff).find((p) => p.props("side") !== "left")!;
}
function patch(value: Partial<DiffTab>) {
  diffs.tabs = diffs.tabs.map((tab) => ({ ...tab, ...value }));
}
async function act(action: HunkAction, index = 0) {
  pane().vm.$emit("hunkAction", index, action);
  await flushPromises();
}
function review() {
  return wrapper.findAll("button").find((button) => button.text() === "diff.refreshHunks")!;
}

it("reports the real ChangesStore's caught status failure and retries only reads", async () => {
  mocks.statusGet.mockRejectedValueOnce(new Error("status IPC failed"));
  await act("stage");
  expect(useChangesStore().error).toBe("status IPC failed");
  expect(wrapper.text()).toContain("diff.hunkRefreshFailed");
  expect(mocks.toast).not.toHaveBeenCalled();
  await review().trigger("click");
  await flushPromises();
  expect(useChangesStore().error).toBeNull();
  expect(mocks.stageHunks).toHaveBeenCalledOnce();
  expect(mocks.statusGet).toHaveBeenCalledTimes(2);
});

it.each(["stage", "unstage", "revert"] as const)(
  "%s sends the exact preview and refreshes the real store without opening another tab",
  async (action) => {
    if (action === "unstage") patch({ left: "head", right: "index" });
    await flushPromises();
    const expected = diffs.tabs[0]!.result!.hunks;
    await act(action);
    const method =
      action === "stage"
        ? mocks.stageHunks
        : action === "unstage"
          ? mocks.unstageHunks
          : mocks.revertHunks;
    expect(method).toHaveBeenCalledExactlyOnceWith({
      repoId: "A",
      path: "C:/A",
      filePath: "file.txt",
      hunkIndexes: [0],
      expectedHunks: expected,
    });
    expect(method.mock.calls[0]![0].expectedHunks).not.toBe(expected);
    expect(mocks.confirm).toHaveBeenCalledTimes(action === "revert" ? 1 : 0);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.diffFile).toHaveBeenCalledOnce();
    expect(diffs.tabs).toHaveLength(1);
    expect(mocks.toast).toHaveBeenCalledWith({ title: "diff.hunkApplied" });
  },
);

it("canceling rollback leaves all three write methods untouched", async () => {
  mocks.confirm.mockResolvedValue(false);
  await act("revert");
  expect(mocks.revertHunks).not.toHaveBeenCalled();
  expect(mocks.stageHunks).not.toHaveBeenCalled();
  expect(mocks.unstageHunks).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(pane().props("hunkBusy")).toBe(false);
});

it("keeps the pending operation disabled through confirmation, write and refresh", async () => {
  const confirmation = deferred<boolean>(),
    write = deferred<void>(),
    refresh = deferred<void>();
  mocks.confirm.mockReturnValue(confirmation.promise);
  mocks.revertHunks.mockReturnValue(write.promise);
  mocks.refresh.mockReturnValue(refresh.promise);
  await act("revert");
  await act("stage");
  await act("revert");
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(pane().props("hunkBusy")).toBe(true);
  confirmation.resolve(true);
  await flushPromises();
  await act("revert");
  write.resolve();
  await flushPromises();
  expect(pane().props("hunkBusy")).toBe(true);
  refresh.resolve();
  await flushPromises();
  expect(pane().props("hunkBusy")).toBe(false);
  expect(mocks.revertHunks).toHaveBeenCalledOnce();
  expect(mocks.stageHunks).not.toHaveBeenCalled();
});

it.each([
  "repository",
  "same repository reopen",
  "tab round trip",
  "preview",
  "loading",
  "whitespace",
  "unmount",
])("ignores a rollback confirmation after %s changes", async (change) => {
  const pending = deferred<boolean>();
  mocks.confirm.mockReturnValue(pending.promise);
  await act("revert");
  if (change === "repository") mocks.workspace.repoPath = "C:/B";
  else if (change === "same repository reopen") mocks.workspace.token++;
  else if (change === "tab round trip") {
    const id = diffs.activeId;
    diffs.activeId = "other";
    diffs.activeId = id;
  } else if (change === "preview") patch({ result: { ...result(), hunks: [] } });
  else if (change === "loading") patch({ loading: true });
  else if (change === "whitespace") patch({ ignoreWhitespace: "all" });
  else wrapper.unmount();
  pending.resolve(true);
  await flushPromises();
  expect(mocks.revertHunks).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it.each(["repository", "same repository reopen", "tab round trip", "unmount"])(
  "keeps late successful writes out of the current view after %s",
  async (change) => {
    const pending = deferred<void>();
    mocks.stageHunks.mockReturnValue(pending.promise);
    await act("stage");
    if (change === "repository") mocks.workspace.repoPath = "C:/B";
    else if (change === "same repository reopen") mocks.workspace.token++;
    else if (change === "tab round trip") {
      const id = diffs.activeId;
      diffs.activeId = "other";
      diffs.activeId = id;
    } else wrapper.unmount();
    pending.resolve();
    await flushPromises();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.diffFile).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  },
);

it("reports an applied block separately when real reloadTab records an error, then allows a read-only retry", async () => {
  mocks.diffFile.mockRejectedValueOnce(new Error("cannot read diff"));
  await act("stage");
  expect(diffs.tabs[0]!.error).toContain("cannot read diff");
  expect(wrapper.text()).toContain("diff.hunkRefreshFailed");
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(review().attributes("disabled")).toBeUndefined();
  await review().trigger("click");
  await flushPromises();
  expect(diffs.tabs[0]!.error).toBeNull();
  expect(wrapper.text()).not.toContain("diff.hunkRefreshFailed");
  expect(mocks.stageHunks).toHaveBeenCalledOnce();
  expect(mocks.diffFile).toHaveBeenCalledTimes(2);
});

it("still reloads the diff when the changes list refresh fails", async () => {
  mocks.refresh.mockRejectedValueOnce(new Error("status failed"));
  await act("stage");
  expect(mocks.diffFile).toHaveBeenCalledOnce();
  expect(wrapper.text()).toContain("diff.hunkRefreshFailed");
  expect(wrapper.text()).toContain("status failed");
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("allows reviewing after a backend stale-preview rejection without blindly repeating the write", async () => {
  mocks.stageHunks.mockRejectedValueOnce(new Error("diff changed since preview"));
  await act("stage");
  expect(wrapper.text()).toContain("diff.hunkFailed");
  expect(mocks.refresh).not.toHaveBeenCalled();
  await review().trigger("click");
  await flushPromises();
  expect(mocks.stageHunks).toHaveBeenCalledOnce();
  expect(wrapper.text()).not.toContain("diff.hunkFailed");
});

it.each(["whitespace", "historical", "renamed", "binary", "tooLarge", "combined", "head-worktree"])(
  "does not expose block actions on %s previews",
  async (kind) => {
    if (kind === "whitespace") patch({ ignoreWhitespace: "trim" });
    else if (kind === "historical") patch({ leftRev: "abcd" });
    else if (kind === "renamed") patch({ leftPath: "before.txt" });
    else if (kind === "combined") patch({ kind: "combined" });
    else if (kind === "head-worktree") patch({ left: "head" });
    else patch({ result: { ...result(), [kind]: true } });
    await flushPromises();
    for (const editor of wrapper.findAllComponents(CodeMirrorDiff))
      expect(editor.props("hunkControls") ?? []).toEqual([]);
    expect(mocks.stageHunks).not.toHaveBeenCalled();
  },
);

it("rejects invalid indexes, opposite actions, inactive tabs, loading and failed previews", async () => {
  await act("unstage");
  await act("stage", 99);
  diffs.activeId = "other";
  await act("stage");
  diffs.activeId = diffs.tabs[0]!.id;
  patch({ loading: true });
  await flushPromises();
  await act("stage");
  patch({ loading: false, error: "read error" });
  await flushPromises();
  await act("stage");
  expect(mocks.stageHunks).not.toHaveBeenCalled();
  expect(mocks.unstageHunks).not.toHaveBeenCalled();
});

it("offers pure-deletion blocks in all four layouts and serializes with legacy line staging", async () => {
  const deletion = {
    ...result(),
    rightText: "",
    hunks: [{ ...result().hunks[0]!, newStart: 0, newLines: 0, lines: ["-old"] }],
  };
  patch({ result: deletion, textsLoaded: true });
  for (const unified of [false, true])
    for (const collapseUnchanged of [false, true]) {
      patch({ unified, collapseUnchanged });
      await flushPromises();
      expect(
        pane()
          .props("hunkControls")!
          .map((item) => item.action),
      ).toEqual(["stage", "revert"]);
      expect(pane().props("hunkAnchors")).toHaveLength(1);
    }
  patch({ result: result() });
  await flushPromises();
  const input = deferred<string>();
  mocks.prompt.mockReturnValue(input.promise);
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "diff.stageSelectedLines")!
    .trigger("click");
  await act("stage");
  expect(mocks.stageHunks).not.toHaveBeenCalled();
  input.resolve("1");
  await flushPromises();
  expect(mocks.stageLines).toHaveBeenCalledOnce();
});
