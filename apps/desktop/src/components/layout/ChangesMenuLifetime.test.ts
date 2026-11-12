import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { reactive } from "vue";
import CommitToolWindow from "./CommitToolWindow.vue";
import ChangesTree from "@/features/commit/ChangesTree.vue";

const mocks = vi.hoisted(() => ({
  ws: {} as any,
  changes: {} as any,
  settings: {} as any,
  confirm: vi.fn(),
  prompt: vi.fn(),
  checkout: vi.fn(),
  toast: vi.fn(),
  open: vi.fn(),
  patch: vi.fn(),
  dialog: vi.fn(),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({ commitControlsHidden: true }) }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => ({ refreshOpState: vi.fn() }) }));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => ({}) }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({ open: mocks.open }) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({}) }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/composables/useConfirm", () => ({
  confirmDialog: mocks.confirm,
  promptDialog: mocks.prompt,
}));
vi.mock("@/composables/useDialog", () => ({ openDialog: mocks.dialog }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ checkoutPathFromRev: mocks.checkout }) }));
vi.mock("@/actions", () => ({ runAction: mocks.patch }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
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
  mocks.changes = reactive({
    stagingMode: true,
    loading: false,
    error: null,
    selectedPaths: ["first.txt", "second.txt"],
    selectedSection: "staged",
    staged: [{ path: "first.txt" }, { path: "second.txt" }],
    unstaged: [],
    unversioned: [],
    ignored: [],
    changelists: { lists: [] },
    refresh: vi.fn(),
    stage: vi.fn(),
    unstage: vi.fn(),
    add: vi.fn(),
    rmCached: vi.fn(),
    createChangelist: vi.fn(),
    moveToChangelist: vi.fn(),
  });
  mocks.settings = reactive({
    settings: { stagingMode: true, git: { changesListMode: "tree" } },
    emptySettings: () => ({ stagingMode: true, git: { changesListMode: "tree" } }),
    save: vi.fn(async (next: unknown) => {
      mocks.settings.settings = next;
    }),
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
async function openMenu() {
  wrapper.findComponent(ChangesTree).vm.$emit("context", {
    path: "first.txt",
    section: mocks.changes.selectedSection,
    x: 10,
    y: 10,
  });
  await flushPromises();
}
async function click(label: string) {
  await wrapper
    .findAll("button")
    .find((b) => b.text() === label)!
    .trigger("click");
  await flushPromises();
}

it.each(["repository", "navigation", "selection", "section"])(
  "closes an open menu after %s changes",
  async (kind) => {
    await openMenu();
    expect(wrapper.find("[data-menu]").exists()).toBe(true);
    if (kind === "repository") mocks.ws.repoPath = "B";
    if (kind === "navigation") mocks.ws.generation++;
    if (kind === "selection") mocks.changes.selectedPaths.splice(0, 1, "other.txt");
    if (kind === "section") mocks.changes.selectedSection = "unstaged";
    await flushPromises();
    expect(wrapper.find("[data-menu]").exists()).toBe(false);
  },
);

it.each(["navigation", "roundtrip", "unmount"])(
  "cancels confirmed rollback after %s invalidates its source",
  async (kind) => {
    const answer = deferred<{ paths: string[] } | null>();
    mocks.dialog.mockReturnValue(answer.promise);
    await openMenu();
    await click("commitTw.rollback");
    if (kind === "navigation") mocks.ws.generation++;
    if (kind === "roundtrip") {
      mocks.ws.repoPath = "B";
      mocks.ws.repoPath = "A";
    }
    if (kind === "unmount") wrapper.unmount();
    answer.resolve({ paths: ["first.txt", "second.txt"] });
    await flushPromises();
    expect(mocks.changes.unstage).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  },
);

it("keeps the original files and section through a rollback confirmation", async () => {
  const answer = deferred<{ paths: string[] } | null>();
  mocks.dialog.mockReturnValue(answer.promise);
  await openMenu();
  await click("commitTw.rollback");
  mocks.changes.selectedPaths.splice(0, 2, "other.txt");
  mocks.changes.selectedSection = "unstaged";
  answer.resolve({ paths: ["first.txt", "second.txt"] });
  await flushPromises();
  expect(mocks.changes.unstage).toHaveBeenCalledWith(["first.txt", "second.txt"]);
  expect(mocks.checkout.mock.calls.map(([arg]) => arg)).toEqual([
    { repoId: "A", path: "A", rev: "HEAD", filePath: "first.txt" },
    { repoId: "A", path: "A", rev: "HEAD", filePath: "second.txt" },
  ]);
});

it.each(["unstage", "checkout"])("stops rollback after navigation during %s", async (step) => {
  const pending = deferred<void>();
  if (step === "unstage") mocks.changes.unstage.mockReturnValue(pending.promise);
  else mocks.checkout.mockReturnValueOnce(pending.promise);
  mocks.dialog.mockResolvedValue({ paths: ["first.txt", "second.txt"] });
  await openMenu();
  await click("commitTw.rollback");
  mocks.ws.repoPath = "B";
  mocks.ws.repoId = "B";
  pending.resolve();
  await flushPromises();
  expect(mocks.checkout).toHaveBeenCalledTimes(step === "checkout" ? 1 : 0);
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("cancels untracking when its confirmation is dismissed", async () => {
  mocks.dialog.mockResolvedValue(null);
  await openMenu();
  await click("commitTw.untrack");
  expect(mocks.changes.rmCached).not.toHaveBeenCalled();
});

it("does not untrack files after its confirmation outlives the repository", async () => {
  const answer = deferred<{ addToGitignore: boolean }>();
  mocks.dialog.mockReturnValue(answer.promise);
  await openMenu();
  await click("commitTw.untrack");
  mocks.ws.generation++;
  answer.resolve({ addToGitignore: true });
  await flushPromises();
  expect(mocks.changes.rmCached).not.toHaveBeenCalled();
});

it.each([true, false])(
  "honors explicit untracking with addToGitignore=%s",
  async (addToGitignore) => {
    mocks.dialog.mockResolvedValue({ addToGitignore });
    await openMenu();
    await click("commitTw.untrack");
    expect(mocks.changes.rmCached).toHaveBeenCalledWith(
      ["first.txt", "second.txt"],
      addToGitignore,
    );
  },
);

it("ignores an already queued menu click after navigation", async () => {
  await openMenu();
  const button = wrapper.findAll("button").find((b) => b.text() === "commitTw.openFile")!;
  mocks.ws.generation++;
  await button.trigger("click");
  expect(mocks.open).not.toHaveBeenCalled();
});

it("closes when a status refresh removes the menu's files from their section", async () => {
  mocks.changes.pathsForSection = vi.fn().mockReturnValue([]);
  await openMenu();
  mocks.changes.snapshot = { files: [] };
  await flushPromises();
  expect(wrapper.find("[data-menu]").exists()).toBe(false);
});
