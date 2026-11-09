import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive, shallowRef } from "vue";
import ConflictsDialog from "./ConflictsDialog.vue";

const mocks = vi.hoisted(() => ({
  ws: {} as { repoPath: string },
  conflicts: {} as any,
  rewrite: {} as any,
  dialog: {} as any,
  close: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/conflictsStore", () => ({ useConflictsStore: () => mocks.conflicts }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("@/composables/useDialog", () => ({
  useDialogState: () => mocks.dialog,
  closeDialog: mocks.close,
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.ws = reactive({ repoPath: "A" });
  mocks.dialog = shallowRef({ id: 7 });
  mocks.conflicts = reactive({
    selected: [],
    entries: [
      { path: "one.txt", kind: "content", yours: "modified", theirs: "modified" },
      { path: "two.txt", kind: "content", yours: "modified", theirs: "modified" },
    ],
    list: { yoursLabel: "main", theirsLabel: "feature" },
    busy: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    openMerge: vi.fn().mockResolvedValue(undefined),
    toggleSelect: vi.fn(),
    acceptSide: vi.fn(),
    resolveSimple: vi.fn(),
  });
  mocks.rewrite = reactive({
    busy: false,
    refreshOpState: vi.fn().mockResolvedValue(undefined),
    opState: { kind: "merge" },
    continueOp: vi.fn(),
  });
});
afterEach(() => wrapper?.unmount());

it("selects rows by click, opens once on double-click, and closes only after loading", async () => {
  const pending = deferred();
  mocks.conflicts.openMerge.mockReturnValue(pending.promise);
  wrapper = mount(ConflictsDialog);
  await flushPromises();
  const rows = wrapper.findAll("tbody tr");
  await rows[1]!.trigger("click");
  expect(mocks.conflicts.selected).toEqual(["two.txt"]);
  await rows[1]!.trigger("dblclick");
  await rows[1]!.trigger("dblclick");
  expect(mocks.conflicts.openMerge).toHaveBeenCalledOnce();
  expect(mocks.close).not.toHaveBeenCalled();
  pending.resolve();
  await flushPromises();
  expect(mocks.close).toHaveBeenCalledWith(true, 7);
});

it("does not open an editor when double-clicking the selection checkbox", async () => {
  wrapper = mount(ConflictsDialog);
  await flushPromises();
  await wrapper.get('input[type="checkbox"]').trigger("dblclick");
  expect(mocks.conflicts.openMerge).not.toHaveBeenCalled();
});

it("shows a load error instead of claiming every conflict was resolved", async () => {
  mocks.conflicts.entries = [];
  mocks.conflicts.refresh.mockRejectedValueOnce(new Error("read failed"));
  wrapper = mount(ConflictsDialog);
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("read failed");
  expect(wrapper.text()).not.toContain("merge.allResolved");
  expect(wrapper.text()).not.toContain("merge.commitMerge");
});

it("invalidates its request when repositories switch and never closes a replacement dialog", async () => {
  const pending = deferred();
  mocks.conflicts.openMerge.mockReturnValue(pending.promise);
  wrapper = mount(ConflictsDialog);
  await flushPromises();
  await wrapper.get("tbody tr").trigger("dblclick");
  mocks.ws.repoPath = "B";
  mocks.dialog.value = { id: 8 };
  mocks.ws.repoPath = "A";
  pending.resolve();
  await flushPromises();
  expect(mocks.close.mock.calls.every((call) => call[0] === false && call[1] === 7)).toBe(true);
});

it("dismisses with Escape when idle", async () => {
  wrapper = mount(ConflictsDialog);
  await flushPromises();
  await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
  expect(mocks.close).toHaveBeenCalledWith(false, 7);
});

it("keeps the conflict dialog open when continuing encounters another conflict", async () => {
  mocks.conflicts.entries = [];
  mocks.rewrite.continueOp.mockImplementation(async () => {
    mocks.conflicts.entries = [
      { path: "next.txt", kind: "content", yours: "modified", theirs: "modified" },
    ];
    return { outcome: "conflicts" };
  });
  wrapper = mount(ConflictsDialog);
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "merge.commitMerge")!
    .trigger("click");
  await flushPromises();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("next.txt");
});
