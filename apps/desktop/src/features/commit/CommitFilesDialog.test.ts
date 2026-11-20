import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { reactive } from "vue";
import CommitFilesDialog from "./CommitFilesDialog.vue";
import PathChecklist from "@/components/common/PathChecklist.vue";

const mocks = vi.hoisted(() => ({ close: vi.fn(), changes: {} as any, workspace: {} as any }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: mocks.close,
  useDialogState: () => ({ value: { id: 54 } }),
}));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
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
it("limits candidates to the original selection and returns an adjusted subset", async () => {
  const wrapper = fixture();
  expect(
    wrapper
      .getComponent(PathChecklist)
      .props("files")
      .map((file) => file.path),
  ).toEqual(["src/a.ts", "src/b.ts"]);
  await wrapper.get('input[aria-label="src/a.ts"]').setValue(false);
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith({ paths: ["src/b.ts"] }, 54);
});
it("does not refill an explicitly cleared selection after background refresh", async () => {
  const wrapper = fixture();
  wrapper.getComponent(PathChecklist).vm.$emit("update:modelValue", []);
  mocks.changes.available = ["src/a.ts", "other.txt"];
  await wrapper.vm.$nextTick();
  expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeDefined();
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).not.toHaveBeenCalled();
});
it("prunes vanished files and revalidates even before a refresh watcher runs", async () => {
  const wrapper = fixture();
  mocks.changes.available = ["src/b.ts", "other.txt"];
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith({ paths: ["src/b.ts"] }, 54);
});
it("cancels without changing selection outside the dialog", async () => {
  const wrapper = fixture();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "common.cancel")!
    .trigger("click");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 54);
  expect(mocks.changes.available).toEqual(["src/a.ts", "src/b.ts", "other.txt"]);
});
it("invalidates on same-repository navigation and rejects a stale submit", async () => {
  const wrapper = fixture();
  mocks.workspace.nav++;
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 54);
  mocks.close.mockClear();
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).not.toHaveBeenCalled();
});
it("explains the staging scope and invalidates on mode change", async () => {
  mocks.changes.stagingMode = true;
  const wrapper = fixture();
  expect(wrapper.text()).toContain("commitTw.commitFilesStagingHint");
  mocks.changes.stagingMode = false;
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 54);
  mocks.close.mockClear();
  await wrapper.get("form").trigger("submit");
  expect(mocks.close).not.toHaveBeenCalled();
});
