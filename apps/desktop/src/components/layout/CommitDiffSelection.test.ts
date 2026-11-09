import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { reactive } from "vue";
import CommitToolWindow from "./CommitToolWindow.vue";
import ChangesTree from "@/features/commit/ChangesTree.vue";
import { registerVcsActions } from "@/actions/definitions/vcs";
import type { ActionDef } from "@/actions/types";
import type { ChangesSection } from "@/stores/changesStore";

const mocks = vi.hoisted(() => ({
  changes: {} as any,
  openFileDiff: vi.fn(),
  actions: new Map<string, ActionDef>(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: () => ({ repoPath: "repo", folderPath: "repo", isRepo: true }),
}));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/stores/diffStore", () => ({
  useDiffStore: () => ({ openFileDiff: mocks.openFileDiff }),
}));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({ commitControlsHidden: true }) }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => ({ refreshOpState: vi.fn() }) }));
vi.mock("@/stores/commitStore", () => ({ useCommitStore: () => ({}) }));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => ({}) }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({}) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => ({}) }));
vi.mock("@/stores/compareStore", () => ({ useCompareStore: () => ({}) }));
vi.mock("@/stores/repoAtRevStore", () => ({ useRepoAtRevStore: () => ({}) }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/composables/useConfirm", () => ({ promptDialog: vi.fn(), confirmDialog: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({}) }));
vi.mock("@/actions", () => ({ runAction: vi.fn() }));
vi.mock("@/actions/registry", () => ({
  registerAction: (action: ActionDef) => mocks.actions.set(action.id, action),
}));

let wrapper: ReturnType<typeof shallowMount>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.openFileDiff.mockResolvedValue(undefined);
  mocks.changes = reactive({
    stagingMode: false,
    loading: false,
    error: null,
    selectedPaths: ["中文 added.txt"],
    selectedSection: "changelist:default",
    staged: [],
    unstaged: [],
    changelists: { lists: [] },
    refresh: vi.fn(),
  });
  registerVcsActions();
  wrapper = shallowMount(CommitToolWindow, {
    global: {
      stubs: {
        Button: { template: "<button><slot /></button>" },
        ContextMenuSurface: { template: "<div><slot /></div>" },
      },
    },
  });
});
afterEach(() => wrapper.unmount());

async function open(entry: "tree" | "context" | "shortcut", section: ChangesSection) {
  const path = mocks.changes.selectedPaths[0];
  mocks.changes.selectedSection = section;
  if (entry === "tree") {
    wrapper.findComponent(ChangesTree).vm.$emit("openDiff", path, section);
  } else if (entry === "context") {
    wrapper.findComponent(ChangesTree).vm.$emit("context", { path, section, x: 10, y: 10 });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "commitTw.showDiff")!
      .trigger("click");
  } else {
    await mocks.actions.get("Diff.ShowDiff")!.run({
      repoIds: ["repo"],
      selection: {},
      source: "shortcut",
      place: "changes",
    });
  }
  await flushPromises();
}

describe.each(["tree", "context", "shortcut"] as const)("%s change diff", (entry) => {
  it.each(["R", "C"])(
    "compares the original HEAD path for staged %s changes",
    async (indexStatus) => {
      mocks.changes.staged = [{ path: "中文 added.txt", origPath: "old name.txt", indexStatus }];
      await open(entry, "changelist:default");
      expect(mocks.openFileDiff).toHaveBeenCalledExactlyOnceWith(
        "中文 added.txt",
        "head",
        "index",
        {
          leftPath: "old name.txt",
        },
      );
    },
  );

  it("uses the destination path on both sides of an unstaged edit after a staged rename", async () => {
    mocks.changes.staged = [{ path: "中文 added.txt", origPath: "old name.txt", indexStatus: "R" }];
    mocks.changes.unstaged = [{ path: "中文 added.txt" }];
    await open(entry, "changelist:default");
    expect(mocks.openFileDiff).toHaveBeenCalledExactlyOnceWith(
      "中文 added.txt",
      "index",
      "worktree",
    );
  });

  it.each(["added", "modified", "deleted", "renamed"])(
    "shows a staged-only %s in a changelist",
    async (kind) => {
      mocks.changes.staged = [{ path: "中文 added.txt", kind }];
      // Other files' unstaged changes must not affect the selected file.
      mocks.changes.unstaged = [{ path: "other.txt", kind: "modified" }];
      await open(entry, "changelist:default");
      expect(mocks.openFileDiff).toHaveBeenCalledExactlyOnceWith("中文 added.txt", "head", "index");
    },
  );

  it("shows unstaged edits when the file has both staged and unstaged changes", async () => {
    mocks.changes.staged = [{ path: "中文 added.txt" }];
    mocks.changes.unstaged = [{ path: "中文 added.txt" }];
    await open(entry, "changelist:default");
    expect(mocks.openFileDiff).toHaveBeenCalledExactlyOnceWith(
      "中文 added.txt",
      "index",
      "worktree",
    );
  });

  it.each(["unstaged", "unversioned", "ignored", "changelist:other"] as ChangesSection[])(
    "keeps the working-tree comparison for %s without a staged-only change",
    async (section) => {
      await open(entry, section);
      expect(mocks.openFileDiff).toHaveBeenCalledExactlyOnceWith(
        "中文 added.txt",
        "index",
        "worktree",
      );
    },
  );

  it("honors explicit staged and unstaged sections for the same mixed file", async () => {
    mocks.changes.staged = [{ path: "中文 added.txt" }];
    mocks.changes.unstaged = [{ path: "中文 added.txt" }];
    await open(entry, "staged");
    expect(mocks.openFileDiff).toHaveBeenLastCalledWith("中文 added.txt", "head", "index");
    await open(entry, "unstaged");
    expect(mocks.openFileDiff).toHaveBeenLastCalledWith("中文 added.txt", "index", "worktree");
  });
});
