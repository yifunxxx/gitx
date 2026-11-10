import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { computed, reactive, shallowRef } from "vue";
import InteractiveRebaseEditor from "./InteractiveRebaseEditor.vue";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  rewrite: {} as any,
  dialog: {} as any,
  stack: {} as any,
  close: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("@/composables/useDialog", () => ({
  useDialogState: () => mocks.dialog,
  useDialogStack: () => mocks.stack,
  closeDialog: mocks.close,
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const plan = () => ({
  base: "base",
  onto: null,
  rebaseMerges: false,
  autosquash: false,
  items: [
    { sha: "1111111", action: "pick", subject: "first", author: "qa", message: null },
    {
      sha: "2222222",
      action: "reword",
      subject: "second",
      author: "qa",
      message: "my new message",
    },
  ],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let wrapper: ReturnType<typeof mount> | undefined;
const startButton = () =>
  wrapper!.findAll("button").find((b) => b.text() === "merge.startRebasing")!;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace = reactive({
    repoPath: "A",
    repoId: "A",
    isRepo: true,
    navigation: 1,
    navigationToken() {
      return this.navigation;
    },
  });
  mocks.dialog = shallowRef({ id: 42 });
  mocks.stack = computed(() => [mocks.dialog.value]);
  mocks.rewrite = reactive({
    busy: false,
    loadInteractivePlan: vi.fn().mockResolvedValue(plan()),
    startInteractive: vi.fn(),
  });
});
afterEach(() => wrapper?.unmount());

it("passes root and onto options and keeps native topology ordering", async () => {
  wrapper = mount(InteractiveRebaseEditor, {
    props: { root: true, onto: "release", rebaseMerges: true, autosquash: true },
  });
  await flushPromises();
  expect(mocks.rewrite.loadInteractivePlan).toHaveBeenCalledWith("", false);
  expect(wrapper.get('[aria-label="merge.moveCommitDown"]').attributes("disabled")).toBeDefined();
  await startButton().trigger("click");
  expect(mocks.rewrite.startInteractive).toHaveBeenCalledWith(
    expect.objectContaining({ onto: "release", rebaseMerges: true, autosquash: true }),
  );
});

it("keeps the edited plan and presents errors so a failed rebase can be retried", async () => {
  mocks.rewrite.startInteractive.mockRejectedValueOnce(new Error("index locked"));
  wrapper = mount(InteractiveRebaseEditor, { props: { fromSha: "1111111" } });
  await flushPromises();
  await wrapper.get("input").setValue("keep this message");
  await startButton().trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("index locked");
  expect((wrapper.get("input").element as HTMLInputElement).value).toBe("keep this message");
  expect(mocks.close).not.toHaveBeenCalled();
  mocks.rewrite.startInteractive.mockResolvedValueOnce({ outcome: "success" });
  await startButton().trigger("click");
  await flushPromises();
  expect(mocks.rewrite.startInteractive.mock.calls[1][0].items[1].message).toBe(
    "keep this message",
  );
  expect(mocks.close).toHaveBeenCalledWith(true, 42);
});

it("does not close when the dirty-worktree choice cancels the operation", async () => {
  mocks.rewrite.startInteractive.mockResolvedValue(null);
  wrapper = mount(InteractiveRebaseEditor, { props: { fromSha: "1111111" } });
  await flushPromises();
  await startButton().trigger("click");
  await flushPromises();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(wrapper.findAll("tbody tr")).toHaveLength(2);
});

it("prevents duplicate submissions and editing or Escape while rebasing", async () => {
  const pending = deferred<unknown>();
  mocks.rewrite.startInteractive.mockReturnValue(pending.promise);
  wrapper = mount(InteractiveRebaseEditor, { props: { fromSha: "1111111" } });
  await flushPromises();
  await startButton().trigger("click");
  await startButton().trigger("click");
  await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
  expect(mocks.rewrite.startInteractive).toHaveBeenCalledOnce();
  expect(wrapper.get("input").attributes("disabled")).toBeDefined();
  expect(mocks.close).not.toHaveBeenCalled();
  pending.resolve({ outcome: "success" });
  await flushPromises();
  expect(mocks.close).toHaveBeenCalledWith(true, 42);
});

it("never submits a late plan after switching repositories away and back", async () => {
  const pending = deferred<ReturnType<typeof plan>>();
  mocks.rewrite.loadInteractivePlan.mockReturnValue(pending.promise);
  wrapper = mount(InteractiveRebaseEditor, { props: { fromSha: "1111111" } });
  mocks.workspace.repoPath = "B";
  mocks.workspace.repoPath = "A";
  mocks.dialog.value = { id: 43 };
  pending.resolve(plan());
  await flushPromises();
  await startButton().trigger("click");
  expect(mocks.rewrite.startInteractive).not.toHaveBeenCalled();
  expect(wrapper.findAll("tbody tr")).toHaveLength(0);
  expect(mocks.close.mock.calls.every((call) => call[0] === false && call[1] === 42)).toBe(true);
});

it("does not close a replacement dialog when an earlier operation finishes", async () => {
  const pending = deferred<unknown>();
  mocks.rewrite.startInteractive.mockReturnValue(pending.promise);
  wrapper = mount(InteractiveRebaseEditor, { props: { fromSha: "1111111" } });
  await flushPromises();
  await startButton().trigger("click");
  mocks.dialog.value = { id: 43 };
  pending.resolve({ outcome: "success" });
  await flushPromises();
  expect(mocks.close).not.toHaveBeenCalled();
});

it("invalidates the plan as soon as same-path navigation starts", async () => {
  wrapper = mount(InteractiveRebaseEditor, { props: { fromSha: "1111111" } });
  await flushPromises();
  ++mocks.workspace.navigation;
  await startButton().trigger("click");
  expect(mocks.rewrite.startInteractive).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledWith(false, 42);
});

it("can retry a failed plan load without changing its original source", async () => {
  mocks.rewrite.loadInteractivePlan.mockRejectedValueOnce(new Error("load failed"));
  wrapper = mount(InteractiveRebaseEditor, { props: { fromSha: "1111111" } });
  await flushPromises();
  await startButton().trigger("click");
  expect(mocks.rewrite.startInteractive).not.toHaveBeenCalled();
  await wrapper.setProps({ fromSha: "replacement" });
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "empty.retry")!
    .trigger("click");
  await flushPromises();
  expect(mocks.rewrite.loadInteractivePlan).toHaveBeenLastCalledWith("1111111", false);
  expect(wrapper.findAll("tbody tr")).toHaveLength(2);
});
