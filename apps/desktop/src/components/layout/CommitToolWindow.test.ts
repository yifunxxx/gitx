import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { reactive } from "vue";
import CommitToolWindow from "./CommitToolWindow.vue";
import ChangesTree from "@/features/commit/ChangesTree.vue";

const mocks = vi.hoisted(() => ({
  ws: {} as any,
  changes: {} as any,
  prompt: vi.fn(),
  toast: vi.fn(),
  navigation: 0,
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({ commitControlsHidden: true }) }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => ({ refreshOpState: vi.fn() }) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({}) }));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => ({}) }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({}) }));
vi.mock("@/stores/historyStore", () => ({ useHistoryStore: () => ({}) }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/composables/useConfirm", () => ({ promptDialog: mocks.prompt, confirmDialog: vi.fn() }));
vi.mock("@/actions", () => ({ runAction: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({}) }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const created = { lists: [{ id: "new-id", name: "new-list" }], assignments: [] };
let wrapper: ReturnType<typeof shallowMount>;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.navigation = 1;
  mocks.ws = reactive({
    repoPath: "A",
    folderPath: "A",
    isRepo: true,
    navigationToken: () => mocks.navigation,
  });
  mocks.changes = reactive({
    stagingMode: false,
    loading: false,
    error: null,
    selectedPaths: ["first.txt"],
    changelists: { lists: [] },
    refresh: vi.fn(),
    createChangelist: vi.fn().mockResolvedValue(created),
    moveToChangelist: vi.fn().mockResolvedValue(created),
  });
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
const clickNew = () =>
  wrapper
    .findAll("button")
    .find((b) => b.text() === "changelist.new")!
    .trigger("click");
async function clickMove() {
  wrapper
    .findComponent(ChangesTree)
    .vm.$emit("context", { path: "first.txt", section: "changelist:default", x: 10, y: 10 });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "commitTw.moveToChangelist")!
    .trigger("click");
}

it("does not create a list after navigation invalidates its naming dialog", async () => {
  const answer = deferred<string>();
  mocks.prompt.mockReturnValue(answer.promise);
  await clickNew();
  mocks.navigation += 2;
  answer.resolve("new-list");
  await flushPromises();
  expect(mocks.changes.createChangelist).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("does not move files after navigation invalidates the dialog", async () => {
  const answer = deferred<string>();
  mocks.prompt.mockReturnValue(answer.promise);
  await clickMove();
  mocks.navigation += 1;
  answer.resolve("new-list");
  await flushPromises();
  expect(mocks.changes.createChangelist).not.toHaveBeenCalled();
  expect(mocks.changes.moveToChangelist).not.toHaveBeenCalled();
});

it("retains the selected files and uses the created list result for a move", async () => {
  const answer = deferred<string>();
  mocks.prompt.mockReturnValue(answer.promise);
  await clickMove();
  mocks.changes.selectedPaths.splice(0, 1, "other.txt");
  answer.resolve("new-list");
  await flushPromises();
  expect(mocks.changes.moveToChangelist).toHaveBeenCalledWith(["first.txt"], "new-id");
  expect(mocks.toast).toHaveBeenCalledOnce();
});

it("does not continue a move when creating its target list fails or becomes stale", async () => {
  mocks.prompt.mockResolvedValue("new-list");
  mocks.changes.createChangelist.mockResolvedValue(null);
  await clickMove();
  await flushPromises();
  expect(mocks.changes.moveToChangelist).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
});
