import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import CommitFilesDialog from "./CommitFilesDialog.vue";
import PathChecklist from "@/components/common/PathChecklist.vue";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  changes: {} as any,
  workspace: {} as any,
  commit: { runHooks: true, committing: false, commitFiles: vi.fn() },
  rewrite: { busy: false },
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: mocks.close,
  useDialogState: () => ({ value: { id: 54 } }),
}));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/commitStore", () => ({ useCommitStore: () => mocks.commit }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
const committed = { sha: "123456789", subject: "selected files", amended: false };
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.commit.committing = false;
  mocks.commit.runHooks = true;
  mocks.rewrite.busy = false;
  mocks.commit.commitFiles.mockResolvedValue(committed);
  mocks.workspace = reactive({
    repoPath: "repo",
    repoId: "id",
    isRepo: true,
    nav: 0,
    navigationToken() {
      return this.nav;
    },
  });
  mocks.changes = reactive({
    stagingMode: false,
    commitSelection(paths: string[]) {
      return paths.map((path) => ({ path, listIds: ["default"] }));
    },
    available: ["src/a.ts", "src/b.ts", "other.txt"],
    pathsForSection(section: string) {
      return section === "changelist:default" ? this.available : [];
    },
    snapshot: {
      files: [
        {
          path: "src/a.ts",
          origPath: null,
          kind: "modified",
          indexStatus: ".",
          worktreeStatus: "M",
        },
      ],
    },
  });
});
function fixture() {
  return mount(CommitFilesDialog, {
    props: { initialPaths: ["src/a.ts", "src/b.ts"], section: "changelist:default" },
    attachTo: document.body,
  });
}
it("commits the adjusted original subset with the dialog message and closes after success", async () => {
  const wrapper = fixture();
  expect(
    wrapper
      .getComponent(PathChecklist)
      .props("files")
      .map((file) => file.path),
  ).toEqual(["src/a.ts", "src/b.ts"]);
  await wrapper.get('input[aria-label="src/a.ts"]').setValue(false);
  await wrapper.get("textarea").setValue("selected files\n\nbody");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(mocks.commit.commitFiles).toHaveBeenCalledExactlyOnceWith(
    ["src/b.ts"],
    "selected files\n\nbody",
    true,
    [{ path: "src/b.ts", listIds: ["default"] }],
  );
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(committed, 54);
});
it("does not refill an explicitly cleared selection after background refresh", async () => {
  const wrapper = fixture();
  await wrapper.get("textarea").setValue("selected files");
  wrapper.getComponent(PathChecklist).vm.$emit("update:modelValue", []);
  mocks.changes.available = ["src/a.ts", "other.txt"];
  await wrapper.vm.$nextTick();
  expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeDefined();
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).not.toHaveBeenCalled();
});
it("prunes vanished files and revalidates even before a refresh watcher runs", async () => {
  const wrapper = fixture();
  await wrapper.get("textarea").setValue("selected files");
  mocks.changes.available = ["src/b.ts", "other.txt"];
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(mocks.commit.commitFiles).toHaveBeenCalledExactlyOnceWith(
    ["src/b.ts"],
    "selected files",
    true,
    [{ path: "src/b.ts", listIds: ["default"] }],
  );
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(committed, 54);
});
it("cancels without changing selection outside the dialog", async () => {
  const wrapper = fixture();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "common.cancel")!
    .trigger("click");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 54);
  expect(mocks.changes.available).toEqual(["src/a.ts", "src/b.ts", "other.txt"]);
  expect(mocks.commit.commitFiles).not.toHaveBeenCalled();
});
it("invalidates on same-repository navigation and rejects a stale submit", async () => {
  const wrapper = fixture();
  await wrapper.get("textarea").setValue("selected files");
  mocks.workspace.nav++;
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 54);
  mocks.close.mockClear();
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).not.toHaveBeenCalled();
});

it("requires a message and blocks duplicate submission and dismissal while saving", async () => {
  const wrapper = fixture();
  await wrapper.get("form").trigger("submit");
  expect(mocks.commit.commitFiles).not.toHaveBeenCalled();
  const pending = deferred<typeof committed>();
  mocks.commit.commitFiles.mockReturnValue(pending.promise);
  await wrapper.get("textarea").setValue("selected files");
  await wrapper.get("form").trigger("submit");
  await wrapper.get("form").trigger("submit");
  expect(mocks.commit.commitFiles).toHaveBeenCalledOnce();
  expect(wrapper.getComponent(PathChecklist).props("disabled")).toBe(true);
  expect(wrapper.get("textarea").attributes("disabled")).toBeDefined();
  expect(
    wrapper
      .findAll('[role="status"]')
      .some((status) => status.text() === "commitTw.committingFiles"),
  ).toBe(true);
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  wrapper.get("textarea").element.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(mocks.close).not.toHaveBeenCalled();
  pending.resolve(committed);
  await flushPromises();
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(committed, 54);
});

it("does not implicitly submit from file search or checkboxes and keeps message newlines", async () => {
  const wrapper = fixture();
  await wrapper.get("textarea").setValue("ready message");
  for (const selector of ['input[type="search"]', 'input[aria-label="src/a.ts"]']) {
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    wrapper.get(selector).element.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
  }
  const newline = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  wrapper.get("textarea").element.dispatchEvent(newline);
  expect(newline.defaultPrevented).toBe(false);
  expect(mocks.commit.commitFiles).not.toHaveBeenCalled();
});

it.each([
  [new Error("hook rejected"), "hook rejected"],
  [{ code: "indexLocked", message: "File exists (os error 80)" }, "commit.indexLocked"],
])(
  "keeps message, selection and hooks on failure %s so the same dialog can retry",
  async (cause, message) => {
    const wrapper = fixture();
    mocks.commit.commitFiles.mockRejectedValueOnce(cause);
    await wrapper.get("textarea").setValue("retry draft");
    await wrapper.get('input[aria-label="src/a.ts"]').setValue(false);
    await wrapper.get('input[aria-label="commit.runHooks"]').setValue(false);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(message);
    expect(wrapper.get<HTMLTextAreaElement>("textarea").element.value).toBe("retry draft");
    expect(wrapper.getComponent(PathChecklist).props("modelValue")).toEqual(["src/b.ts"]);
    expect(mocks.close).not.toHaveBeenCalled();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(mocks.commit.commitFiles).toHaveBeenLastCalledWith(["src/b.ts"], "retry draft", false, [
      { path: "src/b.ts", listIds: ["default"] },
    ]);
    expect(mocks.close).toHaveBeenCalledExactlyOnceWith(committed, 54);
  },
);

it.each(["navigation", "unmount"])(
  "ignores pending submission feedback after %s",
  async (action) => {
    const wrapper = fixture();
    const pending = deferred<typeof committed>();
    mocks.commit.commitFiles.mockReturnValue(pending.promise);
    await wrapper.get("textarea").setValue("old draft");
    await wrapper.get("form").trigger("submit");
    if (action === "navigation") mocks.workspace.nav++;
    else wrapper.unmount();
    mocks.close.mockClear();
    pending.resolve(committed);
    await flushPromises();
    expect(mocks.close).not.toHaveBeenCalled();
  },
);
it("explains the staging scope and invalidates on mode change", async () => {
  mocks.changes.stagingMode = true;
  const wrapper = fixture();
  await wrapper.get("textarea").setValue("selected files");
  expect(wrapper.text()).toContain("commitTw.commitFilesStagingHint");
  mocks.changes.stagingMode = false;
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 54);
  mocks.close.mockClear();
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).not.toHaveBeenCalled();
});

it.each(["whole to partial", "partial to whole"])(
  "submits the frozen scope after %s in an open dialog",
  async (change) => {
    const old = {
      path: "src/a.ts",
      listIds: ["default"],
      ...(change === "partial to whole" ? { expectedToken: "old-preview" } : {}),
    };
    mocks.changes.commitSelection = () => [old, { path: "src/b.ts", listIds: ["default"] }];
    const wrapper = fixture();
    mocks.changes.commitSelection = () => [
      { path: "src/a.ts", listIds: ["other"], expectedToken: "new-preview" },
    ];
    await wrapper.get('input[aria-label="src/b.ts"]').setValue(false);
    await wrapper.get("textarea").setValue("frozen");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(mocks.commit.commitFiles).toHaveBeenCalledExactlyOnceWith(["src/a.ts"], "frozen", true, [
      old,
    ]);
  },
);
