import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { reactive } from "vue";
import DiffViewer from "./DiffViewer.vue";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  diffs: {} as any,
  prompt: vi.fn(),
  stageLines: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => mocks.diffs }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/composables/useConfirm", () => ({ promptDialog: mocks.prompt }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ stageLines: mocks.stageLines }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let wrapper: ReturnType<typeof shallowMount>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace = reactive({ repoPath: "A", repoId: "A" });
  const tab = {
    id: "index:worktree:first.txt", path: "first.txt", kind: "file",
    left: "index", right: "worktree", loading: false,
    collapseUnchanged: true, unified: false, ignoreWhitespace: "none",
    result: {
      binary: false, tooLarge: false,
      hunks: [{ header: "@@ -1 +1,3 @@", oldStart: 1, newStart: 1, lines: [" old", "+new", "+third"] }],
    },
  };
  mocks.diffs = reactive({
    activeId: tab.id, tabs: [tab], paintEpoch: 0,
    openFileDiff: vi.fn(), reloadTab: vi.fn(),
  });
  mocks.prompt.mockResolvedValue("2");
  mocks.stageLines.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
  wrapper = shallowMount(DiffViewer, {
    props: { tabId: tab.id },
    global: { stubs: {
      Tip: { template: "<div><slot /></div>" },
      Button: { template: "<button><slot /></button>" },
    } },
  });
});
afterEach(() => wrapper.unmount());

function button() {
  return wrapper.findAll("button").find((b) => b.text() === "diff.stageSelectedLines");
}
async function click() {
  await button()!.trigger("click");
  await flushPromises();
}

it.each(["repo", "repo round trip", "tab", "tab round trip", "result", "unmount"])(
  "discards line input after a %s change", async (change) => {
    const input = deferred<string>();
    mocks.prompt.mockReturnValue(input.promise);
    await click();
    if (change.startsWith("repo")) {
      mocks.workspace.repoPath = "B";
      if (change.endsWith("round trip")) mocks.workspace.repoPath = "A";
    } else if (change.startsWith("tab")) {
      mocks.diffs.activeId = "another";
      if (change.endsWith("round trip")) mocks.diffs.activeId = mocks.diffs.tabs[0].id;
    } else if (change === "result") {
      mocks.diffs.tabs[0].result = { ...mocks.diffs.tabs[0].result };
    } else wrapper.unmount();
    input.resolve("2");
    await flushPromises();
    expect(mocks.stageLines).not.toHaveBeenCalled();
  },
);

it("prevents duplicate prompts and writes until the operation finishes", async () => {
  const input = deferred<string>();
  const write = deferred<void>();
  mocks.prompt.mockReturnValue(input.promise);
  mocks.stageLines.mockReturnValue(write.promise);
  await click();
  await click();
  expect(mocks.prompt).toHaveBeenCalledTimes(1);
  input.resolve("2");
  await flushPromises();
  await click();
  expect(mocks.stageLines).toHaveBeenCalledTimes(1);
  write.resolve();
  await flushPromises();
  expect(button()!.attributes("disabled")).toBeUndefined();
});

it.each(["2.5", "2,NaN", "-2", "0", "4294967296", "1e2", "0x10"])(
  "rejects invalid line input %s without staging a subset", async (input) => {
    mocks.prompt.mockResolvedValue(input);
    await click();
    expect(mocks.stageLines).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "diff.noValidLines" }));
  },
);

it("deduplicates valid lines and refreshes the original tab without reopening it", async () => {
  mocks.prompt.mockResolvedValue("2, 2 3");
  await click();
  expect(mocks.stageLines).toHaveBeenCalledWith({ repoId: "A", path: "A", filePath: "first.txt", lines: [2, 3] });
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.diffs.reloadTab).toHaveBeenCalledWith("index:worktree:first.txt");
  expect(mocks.diffs.openFileDiff).not.toHaveBeenCalled();
});

it("shows backend errors and permits retry", async () => {
  mocks.stageLines.mockRejectedValueOnce({ message: "index.lock exists" });
  await click();
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
    title: "diff.stageLinesFailed", description: "index.lock exists", persistent: true,
  }));
  expect(mocks.refresh).not.toHaveBeenCalled();
  await click();
  expect(mocks.stageLines).toHaveBeenCalledTimes(2);
});

it("keeps late write results out of a newly selected repository", async () => {
  const write = deferred<void>();
  mocks.stageLines.mockReturnValue(write.promise);
  await click();
  mocks.workspace.repoPath = "B";
  write.resolve();
  await flushPromises();
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(mocks.diffs.reloadTab).not.toHaveBeenCalled();
  expect(mocks.diffs.openFileDiff).not.toHaveBeenCalled();
});

it("reports refresh failure separately after a successful write", async () => {
  mocks.refresh.mockRejectedValueOnce({ message: "refresh failed" });
  await click();
  expect(mocks.stageLines).toHaveBeenCalledTimes(1);
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
    title: "diff.stagedRefreshFailed", description: "refresh failed", persistent: true,
  }));
});

it.each(["1", "2, 999"])("rejects unchanged or out-of-range input %s", async (input) => {
  mocks.prompt.mockResolvedValue(input);
  await click();
  expect(mocks.stageLines).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "diff.onlyChangedLines" }));
});

it.each(["head", "binary", "tooLarge", "loading", "historical", "empty", "deletions"])(
  "does not offer line staging for %s comparisons", async (kind) => {
    const tab = mocks.diffs.tabs[0];
    if (kind === "head") tab.left = "head";
    else if (kind === "historical") tab.leftRev = "abc123";
    else if (kind === "loading") tab.loading = true;
    else if (kind === "empty") tab.result.hunks = [];
    else if (kind === "deletions") tab.result.hunks[0].lines = ["-old", " remaining"];
    else tab.result[kind] = true;
    await flushPromises();
    expect(button()).toBeUndefined();
  },
);
