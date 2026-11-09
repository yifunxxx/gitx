import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { createI18n } from "vue-i18n";
import zhCN from "@/i18n/locales/zh-CN.json";
import RepoStateBanner from "./RepoStateBanner.vue";

const mocks = vi.hoisted(() => ({ workspace: {} as any, rewrite: {} as any }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/rewriteStore", () => ({ useRewriteStore: () => mocks.rewrite }));
vi.mock("@/composables/useDialog", () => ({ openDialog: vi.fn() }));
vi.mock("./ConflictsDialog.vue", () => ({ default: {} }));

let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  mocks.workspace = reactive({ repoPath: "A", isRepo: true });
  mocks.rewrite = reactive({
    busy: false,
    refreshOpState: vi.fn(),
    continueOp: vi.fn(),
    opState: {
      kind: "rebase",
      phase: "stoppedForEdit",
      headBranch: "feature/topic",
      yoursLabel: "abc1234",
      theirsLabel: "Theirs (commit)",
      step: 3,
      total: 5,
      conflictCount: 0,
    },
  });
  wrapper = mount(RepoStateBanner, {
    global: {
      plugins: [
        createI18n({
          legacy: false,
          locale: "zh-CN",
          messages: { "zh-CN": zhCN },
        }),
      ],
    },
  });
});
afterEach(() => wrapper?.unmount());

it("explains an edit pause using the branch, destination and sequence progress", () => {
  expect(wrapper!.text()).toContain("正在将 feature/topic 变基到 abc1234");
  expect(wrapper!.text()).toContain("(3/5)");
  expect(wrapper!.text()).toContain("已暂停，等待编辑提交");
  expect(wrapper!.text()).not.toContain("Theirs");
  expect(
    wrapper!
      .findAll("button")
      .find((button) => button.text() === "继续")!
      .attributes("disabled"),
  ).toBeUndefined();
});

it("discards late action errors after navigating away and back", async () => {
  let reject!: (reason: Error) => void;
  mocks.rewrite.continueOp.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await wrapper!
    .findAll("button")
    .find((button) => button.text() === "继续")!
    .trigger("click");
  mocks.workspace.repoPath = "B";
  mocks.workspace.repoPath = "A";
  reject(new Error("old repository error"));
  await flushPromises();
  expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
});
