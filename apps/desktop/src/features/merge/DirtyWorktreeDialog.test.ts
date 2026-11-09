import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import zhCN from "@/i18n/locales/zh-CN.json";
import DirtyWorktreeDialog from "./DirtyWorktreeDialog.vue";

const mocks = vi.hoisted(() => ({ workspace: {} as any, dialog: {} as any, close: vi.fn() }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/composables/useDialog", () => ({
  useDialogState: () => mocks.dialog,
  closeDialog: mocks.close,
}));
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace = reactive({ repoPath: "A" });
  mocks.dialog = shallowRef({ id: 47 });
  wrapper = mount(DirtyWorktreeDialog, {
    props: { files: ["c.txt", "untracked.txt"], operation: "rebase" },
    global: {
      plugins: [createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": zhCN } })],
    },
  });
});
afterEach(() => wrapper?.unmount());

it("explains which files stay stashed during a pause before accepting Smart", async () => {
  expect(wrapper!.get('[role="dialog"]').text()).toContain("执行变基前需要处理本地修改");
  expect(wrapper!.text()).toContain("编辑或冲突暂停期间保留在 Stash 中");
  expect(wrapper!.findAll("li").map((item) => item.text())).toEqual(["c.txt", "untracked.txt"]);
  await wrapper!
    .findAll("button")
    .find((button) => button.text() === "Smart 变基")!
    .trigger("click");
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith("smart", 47);
});

it("cancels only its own prompt when the repository changes", () => {
  mocks.dialog.value = { id: 48 };
  mocks.workspace.repoPath = "B";
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith("cancel", 47);
});
