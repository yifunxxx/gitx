import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive, shallowRef } from "vue";
import RewordDialog from "./RewordDialog.vue";
import SquashDialog from "./SquashDialog.vue";
import ResetDialog from "./ResetDialog.vue";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  rewrite: {} as any,
  log: { details: null, commits: [{ sha: "aabbccdd", subject: "subject only" }] },
  backend: { logCommitDetails: vi.fn(), resetPreview: vi.fn() },
  dialog: {} as any,
  close: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("@/stores/logStore", () => ({ useLogStore: () => mocks.log }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/composables/useDialog", () => ({
  useDialogState: () => mocks.dialog,
  closeDialog: mocks.close,
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let wrapper: ReturnType<typeof mount> | undefined;
const submit = () => wrapper!.findAll("button").at(-1)!;
const preview = {
  target: "aabbccdd",
  commitsAffected: 2,
  willDiscardLocal: true,
  dirtyTracked: ["a.txt"],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace = reactive({ repoPath: "A", navigationToken: () => 1 });
  mocks.dialog = shallowRef({ id: 42 });
  mocks.rewrite = reactive({ busy: false, reword: vi.fn(), squash: vi.fn(), reset: vi.fn() });
  mocks.backend.logCommitDetails.mockResolvedValue({
    sha: "aabbccdd",
    subject: "full subject",
    body: "中文正文\nsecond paragraph",
  });
  mocks.backend.resetPreview.mockResolvedValue(preview);
});
afterEach(() => wrapper?.unmount());

it("waits for the full commit message instead of silently dropping its body", async () => {
  const pending = deferred<unknown>();
  mocks.backend.logCommitDetails.mockReturnValue(pending.promise);
  wrapper = mount(RewordDialog, { props: { sha: "aabbccdd" } });
  await submit().trigger("click");
  expect(mocks.rewrite.reword).not.toHaveBeenCalled();
  pending.resolve({ sha: "aabbccdd", subject: "full subject", body: "中文正文\nsecond paragraph" });
  await flushPromises();
  expect(wrapper.get<HTMLTextAreaElement>("textarea").element.value).toBe(
    "full subject\n\n中文正文\nsecond paragraph",
  );
  await submit().trigger("click");
  expect(mocks.rewrite.reword).toHaveBeenCalledWith(
    "aabbccdd",
    "full subject\n\n中文正文\nsecond paragraph",
  );
});

it("does not reset until its preview loads successfully", async () => {
  const pending = deferred<unknown>();
  mocks.backend.resetPreview.mockReturnValue(pending.promise);
  wrapper = mount(ResetDialog, { props: { target: "aabbccdd" } });
  await submit().trigger("click");
  expect(mocks.rewrite.reset).not.toHaveBeenCalled();
  pending.resolve(preview);
  await flushPromises();
  await submit().trigger("click");
  expect(mocks.rewrite.reset).toHaveBeenCalledWith("aabbccdd", "mixed");
});

it("resets hard-reset confirmation when changing modes", async () => {
  wrapper = mount(ResetDialog, { props: { target: "aabbccdd" } });
  await flushPromises();
  await wrapper.get('input[value="hard"]').setValue();
  await submit().trigger("click");
  expect(mocks.rewrite.reset).not.toHaveBeenCalled();
  await wrapper.get('input[value="mixed"]').setValue();
  await wrapper.get('input[value="hard"]').setValue();
  await submit().trigger("click");
  expect(mocks.rewrite.reset).not.toHaveBeenCalled();
  await submit().trigger("click");
  expect(mocks.rewrite.reset).toHaveBeenCalledWith("aabbccdd", "hard");
});

for (const [name, component, props] of [
  ["reword", RewordDialog, { sha: "aabbccdd" }],
  ["squash", SquashDialog, { shas: ["aabbccdd", "ddeeff00"] }],
  ["reset", ResetDialog, { target: "aabbccdd" }],
] as const) {
  it(`${name} can be dismissed after a new navigation starts`, async () => {
    wrapper = mount(component as any, { props });
    await flushPromises();
    mocks.workspace.navigationToken = () => 2;
    await submit().trigger("click");
    expect(mocks.rewrite[name]).not.toHaveBeenCalled();
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "common.cancel")!
      .trigger("click");
    expect(mocks.close).toHaveBeenCalledWith(false, 42);
  });
  it(`${name} preserves the dialog on cancelled operations`, async () => {
    mocks.rewrite[name].mockResolvedValue(null);
    wrapper = mount(component as any, { props });
    await flushPromises();
    await submit().trigger("click");
    await flushPromises();
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it(`${name} prevents duplicate writes and closing while running`, async () => {
    const pending = deferred<unknown>();
    mocks.rewrite[name].mockReturnValue(pending.promise);
    wrapper = mount(component as any, { props });
    await flushPromises();
    await submit().trigger("click");
    await submit().trigger("click");
    await wrapper
      .findAll("button")
      .find((b) => /Cancel|common.cancel/.test(b.text()))!
      .trigger("click");
    await wrapper.trigger("keydown", { key: "Escape" });
    expect(mocks.rewrite[name]).toHaveBeenCalledOnce();
    expect(mocks.close).not.toHaveBeenCalled();
    mocks.dialog.value = { id: 43 };
    pending.resolve({ outcome: "success" });
    await flushPromises();
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it(`${name} invalidates its original repository even after switching back`, async () => {
    wrapper = mount(component as any, { props });
    await flushPromises();
    mocks.workspace.repoPath = "B";
    mocks.workspace.repoPath = "A";
    await submit().trigger("click");
    expect(mocks.rewrite[name]).not.toHaveBeenCalled();
    expect(mocks.close.mock.calls.every((call) => call[0] === false && call[1] === 42)).toBe(true);
  });
  it(`${name} displays failures and retains input for retry`, async () => {
    mocks.rewrite[name].mockRejectedValueOnce(new Error("index locked"));
    wrapper = mount(component as any, { props });
    await flushPromises();
    if (name !== "reset") await wrapper.get("textarea").setValue("keep my message\n\n正文");
    await submit().trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("index locked");
    expect(mocks.close).not.toHaveBeenCalled();
    mocks.rewrite[name].mockResolvedValueOnce({ outcome: "success" });
    await submit().trigger("click");
    await flushPromises();
    expect(mocks.close).toHaveBeenCalledWith(true, 42);
    if (name !== "reset")
      expect(mocks.rewrite[name].mock.lastCall[1]).toBe("keep my message\n\n正文");
  });
}
