import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import { createI18n } from "vue-i18n";
import zhCN from "@/i18n/locales/zh-CN.json";
import RepoStateBanner from "./RepoStateBanner.vue";
const mocks = vi.hoisted(() => ({
  rewrite: {} as any,
  workspace: {} as any,
  layout: {} as any,
  dialog: vi.fn(),
}));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => mocks.layout }));
vi.mock("@/composables/useDialog", () => ({ openDialog: mocks.dialog }));
vi.mock("./ConflictsDialog.vue", () => ({ default: {} }));
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  mocks.workspace = reactive({
    isRepo: true,
    repoPath: "A",
    repoId: "A",
    navigation: 1,
    navigationToken() {
      return this.navigation;
    },
  });
  mocks.layout = reactive({ bottomOpen: false, activeBottomTab: "log" });
  mocks.rewrite = reactive({
    busy: false,
    opState: {
      kind: "normal",
      phase: "normal",
      conflictCount: 0,
      smartRecovery: { sha: "saved", phase: "saved", canRestore: true, pendingCommit: false },
    },
    refreshOpState: vi.fn(),
    restoreSmartChanges: vi.fn(),
    continueOp: vi.fn(),
    abort: vi.fn(),
    skip: vi.fn(),
  });
  wrapper = mount(RepoStateBanner, {
    global: {
      plugins: [createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": zhCN } })],
    },
  });
});
afterEach(() => wrapper.unmount());
const button = (label: string) => wrapper.findAll("button").find((b) => b.text() === label);
it("shows explicit recovery after external completion and opens the Stash pane", async () => {
  expect(wrapper.get('[role="status"]').text()).toContain("操作已经结束");
  expect(button("中止")).toBeUndefined();
  await button("恢复本地修改")!.trigger("click");
  expect(mocks.rewrite.restoreSmartChanges).toHaveBeenCalledOnce();
  await button("查看 Stash")!.trigger("click");
  expect(mocks.layout.bottomOpen).toBe(true);
  expect(mocks.layout.activeBottomTab).toBe("stashesShelves");
});
it.each([
  ["saved", true, "请先提交或撤销"],
  ["attention", false, "避免重复应用"],
])("does not offer unsafe recovery for %s", async (phase, pendingCommit, message) => {
  mocks.rewrite.opState.smartRecovery = { phase, pendingCommit, canRestore: false };
  await flushPromises();
  expect(wrapper.text()).toContain(message);
  expect(button("恢复本地修改")).toBeUndefined();
});
it("offers cleanup rather than another application after work is restored", async () => {
  mocks.rewrite.opState.smartRecovery.phase = "applied";
  await flushPromises();
  expect(button("清理已恢复的保存副本")).toBeDefined();
  expect(button("恢复本地修改")).toBeUndefined();
});
it("disables recovery while busy and displays failures without an unhandled rejection", async () => {
  mocks.rewrite.busy = true;
  await flushPromises();
  expect(button("恢复本地修改")!.attributes("disabled")).toBeDefined();
  mocks.rewrite.busy = false;
  await flushPromises();
  mocks.rewrite.restoreSmartChanges.mockRejectedValue(new Error("saved copy needs attention"));
  await button("恢复本地修改")!.trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("saved copy needs attention");
});
it("does not show late recovery errors after same-path navigation", async () => {
  let reject!: (error: Error) => void;
  mocks.rewrite.restoreSmartChanges.mockReturnValue(
    new Promise((_, no) => {
      reject = no;
    }),
  );
  await button("恢复本地修改")!.trigger("click");
  ++mocks.workspace.navigation;
  reject(new Error("old failure"));
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
});

it("shows squash conflicts without offering a nonexistent merge abort or continue", async () => {
  mocks.rewrite.opState = { kind: "normal", phase: "conflicted", conflictCount: 1 };
  await flushPromises();
  expect(button("解决冲突")).toBeDefined();
  expect(button("中止")).toBeUndefined();
  expect(button("继续")).toBeUndefined();
  expect(button("恢复本地修改")).toBeUndefined();
});
