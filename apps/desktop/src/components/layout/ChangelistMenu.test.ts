import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { reactive } from "vue";
import CommitToolWindow from "./CommitToolWindow.vue";
import ChangesTree from "@/features/commit/ChangesTree.vue";

const mocks = vi.hoisted(() => ({
  ws: {} as any,
  changes: {} as any,
  settings: {} as any,
  layout: {
    commitTwMode: "docked" as string,
    leftOpen: true,
    commitControlsHidden: true,
    vcsPopupOpen: false,
  },
  confirm: vi.fn(),
  prompt: vi.fn(),
  dialog: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => ({ refreshOpState: vi.fn() }) }));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => ({}) }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({}) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({}) }));
vi.mock("@/features/commit/focusCommitUi", () => ({ focusCommitUi: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/composables/useConfirm", () => ({
  confirmDialog: mocks.confirm,
  promptDialog: mocks.prompt,
}));
vi.mock("@/composables/useDialog", () => ({ openDialog: mocks.dialog }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({}) }));
vi.mock("@/actions", () => ({ runAction: vi.fn() }));

let wrapper: ReturnType<typeof shallowMount>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.ws = reactive({
    repoPath: "A",
    repoId: "A",
    toplevel: "A",
    folderPath: "A",
    isRepo: true,
    generation: 1,
    navigationToken() {
      return this.generation;
    },
  });
  mocks.layout = {
    commitTwMode: "docked",
    leftOpen: true,
    commitControlsHidden: true,
    vcsPopupOpen: false,
  };
  mocks.changes = reactive({
    stagingMode: false,
    loading: false,
    error: null,
    selectedPaths: [],
    selectedSection: "changelist:cl-123",
    staged: [],
    unstaged: [],
    unversioned: [],
    ignored: [],
    changed: [],
    snapshot: { files: [] },
    changelists: {
      lists: [
        { id: "default", name: "Changes", comment: "", active: true },
        { id: "cl-123", name: "123", comment: "", active: false },
      ],
      assignments: [],
    },
    checkedPaths: [],
    pathsForSection: vi.fn((section: string) =>
      section === "changelist:cl-123" ? [] : section === "changelist:default" ? [] : [],
    ),
    refresh: vi.fn(),
    createChangelist: vi.fn(),
    moveToChangelist: vi.fn(),
    deleteChangelist: vi.fn(async () => mocks.changes.changelists),
  });
  mocks.settings = reactive({
    settings: { stagingMode: false, git: { changesListMode: "tree" } },
    emptySettings: () => ({ stagingMode: false, git: { changesListMode: "tree" } }),
    save: vi.fn(),
  });
  mocks.confirm.mockResolvedValue(true);
  wrapper = shallowMount(CommitToolWindow, {
    global: {
      stubs: {
        Tip: { template: "<div><slot /></div>" },
        Button: { template: "<button><slot /></button>" },
        ContextMenuSurface: {
          props: ["open"],
          template: '<div data-menu v-if="open"><slot /></div>',
        },
      },
    },
  });
});
afterEach(() => wrapper.unmount());

async function openHeader(section: string) {
  wrapper.findComponent(ChangesTree).vm.$emit("context", {
    path: null,
    section,
    x: 12,
    y: 24,
    header: true,
  });
  await flushPromises();
}

it("offers Delete on an empty custom changelist header and not on default Changes", async () => {
  await openHeader("changelist:cl-123");
  expect(wrapper.find("[data-menu]").text()).toContain("changelist.delete");
  expect(wrapper.find("[data-menu]").text()).not.toContain("commitTw.showDiff");
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "changelist.delete")!
    .trigger("click");
  await flushPromises();
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(mocks.changes.deleteChangelist).toHaveBeenCalledWith("cl-123", "default");

  await openHeader("changelist:default");
  expect(wrapper.find("[data-menu]").text()).not.toContain("changelist.delete");
});

it("opens the move dialog with the preselected files instead of a name prompt", async () => {
  mocks.changes.selectedPaths = ["a.txt"];
  mocks.changes.selectedSection = "changelist:default";
  mocks.changes.pathsForSection.mockReturnValue(["a.txt", "b.txt"]);
  mocks.dialog.mockResolvedValue({
    paths: ["a.txt"],
    targetListId: "cl-123",
    newName: null,
  });
  mocks.changes.moveToChangelist.mockResolvedValue(mocks.changes.changelists);
  wrapper.findComponent(ChangesTree).vm.$emit("context", {
    path: "a.txt",
    section: "changelist:default",
    x: 8,
    y: 9,
    header: false,
  });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "commitTw.moveToChangelist")!
    .trigger("click");
  await flushPromises();
  expect(mocks.prompt).not.toHaveBeenCalled();
  expect(mocks.dialog).toHaveBeenCalledOnce();
  expect(mocks.changes.moveToChangelist).toHaveBeenCalledWith(["a.txt"], "cl-123");
});
