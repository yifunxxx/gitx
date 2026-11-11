import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, reactive, shallowRef } from "vue";
import ConflictsDialog from "./ConflictsDialog.vue";

const m = vi.hoisted(() => ({
  ws: {} as any,
  conflicts: {} as any,
  rewrite: {} as any,
  stack: {} as any,
  dialog: {} as any,
  close: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => m.ws }));
vi.mock("@/stores/conflictsStore", () => ({ useConflictsStore: () => m.conflicts }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => m.rewrite }));
vi.mock("@/composables/useDialog", () => ({
  useDialogStack: () => m.stack,
  useDialogState: () => m.dialog,
  closeDialog: m.close,
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let wrapper: ReturnType<typeof mount> | undefined;
const entry = (path: string) => ({ path, kind: "content", yours: "modified", theirs: "modified" });
const button = (key: string) => wrapper!.findAll("button").find((b) => b.text() === key)!;
async function open() {
  wrapper = mount(ConflictsDialog);
  await flushPromises();
}
beforeEach(() => {
  vi.resetAllMocks();
  m.ws = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    navigation: 0,
    navigationToken() {
      return this.navigation;
    },
  });
  m.stack = shallowRef([{ id: 7 }]);
  m.dialog = computed(() => m.stack.value.at(-1));
  m.close.mockImplementation((_: unknown, id = m.dialog.value?.id) => {
    m.stack.value = m.stack.value.filter((d: any) => d.id !== id);
  });
  m.conflicts = reactive({
    selected: [],
    entries: [entry("one.txt"), entry("two.txt"), entry("three.txt")],
    list: { yoursLabel: "main", theirsLabel: "feature" },
    busy: false,
    loading: false,
    refreshError: null,
    refresh: vi.fn().mockResolvedValue(true),
    openMerge: vi.fn().mockResolvedValue(true),
    toggleSelect: vi.fn((path: string) => {
      m.conflicts.selected = m.conflicts.selected.includes(path)
        ? m.conflicts.selected.filter((p: string) => p !== path)
        : [...m.conflicts.selected, path];
    }),
    acceptSide: vi.fn(),
    resolveSimple: vi.fn(),
  });
  m.rewrite = reactive({
    busy: false,
    refreshOpState: vi.fn().mockResolvedValue({ kind: "merge" }),
    opState: { kind: "merge" },
    continueOp: vi.fn(),
  });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

it("selects a row and opens once on double-click, closing its own dialog only after success", async () => {
  const pending = deferred<boolean>();
  m.conflicts.openMerge.mockReturnValue(pending.promise);
  await open();
  const row = wrapper!.findAll("tbody tr")[1]!;
  await row.trigger("click");
  expect(m.conflicts.selected).toEqual(["two.txt"]);
  await row.trigger("dblclick");
  await row.trigger("dblclick");
  expect(m.conflicts.openMerge).toHaveBeenCalledOnce();
  expect(m.close).not.toHaveBeenCalled();
  pending.resolve(true);
  await flushPromises();
  expect(m.close).toHaveBeenCalledExactlyOnceWith(true, 7);
});

it("keeps failed merge loads open with an error and permits retry", async () => {
  m.conflicts.openMerge.mockRejectedValueOnce(new Error("read failed"));
  await open();
  await wrapper!.get("tbody tr").trigger("dblclick");
  await flushPromises();
  expect(m.close).not.toHaveBeenCalled();
  expect(wrapper!.get('[role="alert"]').text()).toContain("read failed");
  await wrapper!.get("tbody tr").trigger("dblclick");
  await flushPromises();
  expect(m.close).toHaveBeenCalledWith(true, 7);
});

it("does not close when an editor request is skipped", async () => {
  m.conflicts.openMerge.mockResolvedValueOnce(false);
  await open();
  await wrapper!.get("tbody tr").trigger("dblclick");
  await flushPromises();
  expect(m.close).not.toHaveBeenCalled();
});

it("shows initial load failure with retry and never claims conflicts are resolved", async () => {
  m.conflicts.entries = [];
  m.conflicts.refresh.mockRejectedValueOnce(new Error("read failed"));
  await open();
  expect(wrapper!.get('[role="alert"]').text()).toContain("read failed");
  expect(wrapper!.text()).not.toContain("merge.allResolved");
  expect(wrapper!.text()).not.toContain("merge.commitMerge");
  await button("merge.retryLoad").trigger("click");
  await flushPromises();
  expect(wrapper!.text()).toContain("merge.allResolved");
  expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
});

it("waits for both initial reads before releasing the loading guard", async () => {
  const pending = deferred<any>();
  m.rewrite.refreshOpState.mockReturnValueOnce(pending.promise);
  m.conflicts.refresh.mockRejectedValueOnce(new Error("read failed"));
  await open();
  expect(m.close).not.toHaveBeenCalled();
  expect(button("merge.acceptYours").attributes("disabled")).toBeDefined();
  pending.resolve({ kind: "merge" });
  await flushPromises();
  expect(wrapper!.get('[role="alert"]').text()).toContain("read failed");
});

it("loads when opened by a rewrite that is still finishing, while disabling writes", async () => {
  m.rewrite.busy = true;
  await open();
  expect(m.conflicts.refresh).toHaveBeenCalledOnce();
  expect(wrapper!.text()).toContain("one.txt");
  expect(button("merge.acceptYours").attributes("disabled")).toBeDefined();
  m.rewrite.busy = false;
  await flushPromises();
  expect(button("merge.acceptYours").attributes("disabled")).toBeUndefined();
});

it.each(["navigation", "identity", "non-repository"])(
  "invalidates its caller after %s without closing another dialog",
  async (change) => {
    const pending = deferred<boolean>();
    m.conflicts.openMerge.mockReturnValueOnce(pending.promise);
    await open();
    await wrapper!.get("tbody tr").trigger("dblclick");
    const current = m.conflicts.openMerge.mock.calls[0][1];
    m.stack.value = [{ id: 8 }];
    if (change === "navigation") m.ws.navigation++;
    if (change === "identity") m.ws.repoId = "replacement";
    if (change === "non-repository") m.ws.isRepo = false;
    expect(current()).toBe(false);
    pending.resolve(true);
    await flushPromises();
    expect(m.close.mock.calls.every((call) => call[0] === false && call[1] === 7)).toBe(true);
    expect(m.stack.value).toEqual([{ id: 8 }]);
  },
);

it("cancels a pending read with Escape, invalidating its caller", async () => {
  const pending = deferred<boolean>();
  m.conflicts.openMerge.mockReturnValueOnce(pending.promise);
  await open();
  await wrapper!.get("tbody tr").trigger("dblclick");
  const current = m.conflicts.openMerge.mock.calls[0][1];
  await wrapper!.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
  expect(m.close).toHaveBeenCalledExactlyOnceWith(false, 7);
  expect(current()).toBe(false);
  pending.resolve(true);
  await flushPromises();
  expect(m.close).toHaveBeenCalledOnce();
});

it("never revives an opening after a child dialog appears and closes", async () => {
  const pending = deferred<boolean>();
  m.conflicts.openMerge.mockReturnValueOnce(pending.promise);
  await open();
  await wrapper!.get("tbody tr").trigger("dblclick");
  const current = m.conflicts.openMerge.mock.calls[0][1];
  m.stack.value = [{ id: 7 }, { id: 8 }];
  m.stack.value = [{ id: 7 }];
  expect(current()).toBe(false);
  pending.resolve(true);
  await flushPromises();
  expect(m.close).not.toHaveBeenCalled();
});

it("invalidates a caller when unmounted", async () => {
  const pending = deferred<boolean>();
  m.conflicts.openMerge.mockReturnValueOnce(pending.promise);
  await open();
  await wrapper!.get("tbody tr").trigger("dblclick");
  const current = m.conflicts.openMerge.mock.calls[0][1];
  wrapper!.unmount();
  wrapper = undefined;
  expect(current()).toBe(false);
  pending.resolve(true);
  await flushPromises();
  expect(m.close).not.toHaveBeenCalled();
});

it.each([undefined, null, { outcome: "conflicts" }])(
  "keeps a skipped or still-conflicted continuation open (%j)",
  async (result) => {
    m.conflicts.entries = [];
    m.rewrite.continueOp.mockResolvedValueOnce(result);
    await open();
    await button("merge.commitMerge").trigger("click");
    await flushPromises();
    expect(m.close).not.toHaveBeenCalled();
  },
);

it("keeps a failed continuation open and closes only its own dialog after success", async () => {
  m.conflicts.entries = [];
  m.rewrite.continueOp
    .mockRejectedValueOnce(new Error("hook failed"))
    .mockResolvedValueOnce({ outcome: "success" });
  await open();
  await button("merge.commitMerge").trigger("click");
  await flushPromises();
  expect(wrapper!.get('[role="alert"]').text()).toContain("hook failed");
  expect(m.close).not.toHaveBeenCalled();
  await button("merge.commitMerge").trigger("click");
  await flushPromises();
  expect(m.close).toHaveBeenCalledWith(true, 7);
});

it("isolates checkbox double-click and Enter from opening the editor", async () => {
  await open();
  const checkbox = wrapper!.get('input[type="checkbox"]');
  await checkbox.trigger("dblclick");
  await checkbox.trigger("keydown", { key: "Enter" });
  expect(m.conflicts.openMerge).not.toHaveBeenCalled();
});

it("supports Ctrl/Shift selection, handles a removed anchor, and never falls back to accepting all", async () => {
  await open();
  let rows = wrapper!.findAll("tbody tr");
  await rows[0]!.trigger("click");
  await rows[2]!.trigger("click", { shiftKey: true });
  expect(m.conflicts.selected).toEqual(["one.txt", "two.txt", "three.txt"]);
  await rows[0]!.trigger("click");
  m.conflicts.entries = [entry("two.txt"), entry("three.txt")];
  await flushPromises();
  rows = wrapper!.findAll("tbody tr");
  await rows[0]!.trigger("click", { shiftKey: true });
  expect(m.conflicts.selected).toEqual(["two.txt"]);
  await rows[0]!.trigger("click", { ctrlKey: true });
  expect(m.conflicts.selected).toEqual([]);
  expect(button("merge.acceptYours").attributes("disabled")).toBeDefined();
});

it("ignores modified, repeated, IME and busy row shortcuts", async () => {
  await open();
  const row = wrapper!.get("tbody tr");
  for (const event of [
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { metaKey: true },
    { repeat: true },
    { isComposing: true },
  ]) {
    await row.trigger("keydown", { key: "Enter", ...event });
    await row.trigger("keydown", { key: " ", ...event });
  }
  m.conflicts.busy = true;
  await row.trigger("keydown", { key: "Enter" });
  await row.trigger("keydown", { key: " " });
  expect(m.conflicts.openMerge).not.toHaveBeenCalled();
  expect(m.conflicts.toggleSelect).not.toHaveBeenCalled();
});
