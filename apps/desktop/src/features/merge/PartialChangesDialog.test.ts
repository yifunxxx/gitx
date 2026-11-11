import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive, shallowRef } from "vue";
import PartialChangesDialog from "./PartialChangesDialog.vue";

const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  rewrite: {} as any,
  backend: { logCommitDetails: vi.fn(), logChangedFiles: vi.fn() },
  dialog: {} as any,
  stack: {} as any,
  close: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("@/composables/useDialog", () => ({
  useDialogState: () => mocks.dialog,
  useDialogStack: () => mocks.stack,
  closeDialog: mocks.close,
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const files = [
  { path: "nested/中文,[ab].txt", origPath: null, status: "A" },
  { path: "new,name.txt", origPath: "old,name.txt", status: "R100" },
  { path: "unselected.txt", origPath: null, status: "M" },
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let wrapper: ReturnType<typeof mount>;
const submit = () => wrapper.findAll("button").at(-1)!;
const button = (text: string) => wrapper.findAll("button").find((b) => b.text() === text)!;
const open = async (mode: "extract" | "drop" = "extract", initialPaths?: string[]) => {
  wrapper = mount(PartialChangesDialog, {
    props: { commit: "commit-a", mode, initialPaths },
    attachTo: document.body,
  });
  await flushPromises();
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace = reactive({ repoPath: "A", repoId: "A", isRepo: true, navigationToken: () => 1 });
  mocks.dialog = shallowRef({ id: 42 });
  mocks.stack = shallowRef([{ id: 42 }]);
  mocks.rewrite = reactive({
    busy: false,
    extractChanges: vi.fn().mockResolvedValue({}),
    dropChanges: vi.fn().mockResolvedValue({}),
  });
  mocks.backend.logCommitDetails.mockResolvedValue({ subject: "Original commit", body: "Body" });
  mocks.backend.logChangedFiles.mockResolvedValue(files);
});
afterEach(() => wrapper?.unmount());

it("requires explicit selection and preserves literal names when extracting", async () => {
  await open();
  expect(mocks.backend.logChangedFiles).toHaveBeenCalledWith({ path: "A", sha: "commit-a" });
  expect(submit().attributes("disabled")).toBeDefined();
  await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true);
  await wrapper.get("textarea").setValue("Selected change\n\nBody preserved");
  await submit().trigger("click");
  expect(mocks.rewrite.extractChanges).toHaveBeenCalledWith(
    "commit-a",
    [files[0]!.path],
    "Selected change\n\nBody preserved",
  );
  expect(mocks.close).toHaveBeenCalledWith(true, 42);
});

it("searches rename sources, selects filtered files, and retains hidden selections", async () => {
  await open("drop", [files[0]!.path, "missing"]);
  expect(
    wrapper
      .findAll('input[type="checkbox"]')
      .filter((checkbox) => (checkbox.element as HTMLInputElement).checked),
  ).toHaveLength(1);
  await wrapper.get('input[type="search"]').setValue("old,name");
  expect(wrapper.text()).toContain("old,name.txt → new,name.txt");
  await button("rewrite.selectVisible").trigger("click");
  await submit().trigger("click");
  expect(mocks.rewrite.dropChanges).toHaveBeenCalledWith("commit-a", [
    files[0]!.path,
    files[1]!.path,
  ]);
});

it("can clear all selections and navigate checkboxes with the keyboard", async () => {
  await open("extract", [files[0]!.path]);
  await button("rewrite.clearSelection").trigger("click");
  expect(submit().attributes("disabled")).toBeDefined();
  await wrapper.findAll('input[type="checkbox"]')[0]!.trigger("keydown", { key: "End" });
  expect(document.activeElement).toBe(wrapper.findAll('input[type="checkbox"]')[2]!.element);
});

it("waits for complete files, supports load retry, and preserves selection on write failure", async () => {
  mocks.backend.logChangedFiles.mockRejectedValueOnce(new Error("read failed"));
  await open();
  expect(wrapper.get('[role="alert"]').text()).toContain("read failed");
  await button("empty.retry").trigger("click");
  await flushPromises();
  await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true);
  mocks.rewrite.extractChanges.mockRejectedValueOnce(new Error("write failed"));
  await submit().trigger("click");
  await flushPromises();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(wrapper.get('[role="alert"]').text()).toContain("write failed");
  expect((wrapper.findAll('input[type="checkbox"]')[1]!.element as HTMLInputElement).checked).toBe(
    true,
  );
  await submit().trigger("click");
  await flushPromises();
  expect(mocks.close).toHaveBeenCalledWith(true, 42);
});

it("prevents duplicate writes and dismissal while running", async () => {
  const pending = deferred<unknown>();
  mocks.rewrite.dropChanges.mockReturnValue(pending.promise);
  await open("drop", [files[0]!.path]);
  await submit().trigger("click");
  await submit().trigger("click");
  await wrapper.trigger("keydown", { key: "Escape" });
  await button("common.cancel").trigger("click");
  expect(mocks.rewrite.dropChanges).toHaveBeenCalledOnce();
  expect(mocks.close).not.toHaveBeenCalled();
  // Dialog replaced — our entry is no longer on the stack.
  mocks.dialog.value = { id: 43 };
  mocks.stack.value = [{ id: 43 }];
  pending.resolve({});
  await flushPromises();
  expect(mocks.close).not.toHaveBeenCalled();
});

it("ignores late reads after switching repositories and back", async () => {
  const pending = deferred<unknown>();
  mocks.backend.logChangedFiles.mockReturnValue(pending.promise);
  await open("extract", [files[0]!.path]);
  mocks.workspace.repoPath = "B";
  mocks.workspace.repoPath = "A";
  pending.resolve(files);
  await flushPromises();
  expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0);
  await submit().trigger("click");
  expect(mocks.rewrite.extractChanges).not.toHaveBeenCalled();
});

it("can cancel after navigation starts without submitting", async () => {
  await open("drop", [files[0]!.path]);
  mocks.workspace.navigationToken = () => 2;
  await submit().trigger("click");
  expect(mocks.rewrite.dropChanges).not.toHaveBeenCalled();
  await wrapper.trigger("keydown", { key: "Escape" });
  expect(mocks.close).toHaveBeenCalledWith(false, 42);
});
