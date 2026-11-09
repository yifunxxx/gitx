import { beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import PullDialog from "./PullDialog.vue";

const mocks = vi.hoisted(() => ({
  ws: {} as { repoPath: string; branch: { head: string; upstream: string } },
  branches: { refresh: vi.fn(), error: null, remotes: [{ name: "origin" }] },
  sync: { pull: vi.fn(), pulling: false },
  close: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/branchesStore", () => ({ useBranchesStore: () => mocks.branches }));
vi.mock("@/stores/syncStore", () => ({ useSyncStore: () => mocks.sync }));
vi.mock("@/composables/useDialog", () => ({ closeDialog: mocks.close }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ws = reactive({
    repoPath: "A",
    branch: { head: "feature/local", upstream: "origin/feature/remote" },
  });
  mocks.branches.refresh.mockResolvedValue(undefined);
});

it("uses the tracking branch immediately and prevents Pull while remotes load", async () => {
  let ready!: () => void;
  mocks.branches.refresh.mockReturnValue(
    new Promise<void>((resolve) => {
      ready = resolve;
    }),
  );
  const wrapper = mount(PullDialog);
  expect(wrapper.get<HTMLInputElement>('input:not([type="checkbox"])').element.value).toBe(
    "feature/remote",
  );
  const submit = wrapper.findAll("button").find((button) => button.text() === "Pull")!;
  expect(submit.attributes("disabled")).toBeDefined();
  await submit.trigger("click");
  expect(mocks.sync.pull).not.toHaveBeenCalled();
  ready();
  await flushPromises();
  expect(submit.attributes("disabled")).toBeUndefined();
  await submit.trigger("click");
  expect(mocks.sync.pull).toHaveBeenCalledWith(
    expect.objectContaining({ remote: "origin", branch: "feature/remote" }),
  );
  wrapper.unmount();
});

it("does not submit an old dialog after switching away and back to its repository", async () => {
  const wrapper = mount(PullDialog);
  await flushPromises();
  mocks.ws.repoPath = "B";
  mocks.ws.repoPath = "A";
  await flushPromises();
  const submit = wrapper.findAll("button").find((button) => button.text() === "Pull")!;
  expect(submit.attributes("disabled")).toBeDefined();
  expect(wrapper.get('[role="alert"]').text()).toBe("syncUi.repositoryChanged");
  wrapper.unmount();
});

it("does not close another dialog when a dismissed pull finishes", async () => {
  let finish!: () => void;
  mocks.sync.pull.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const wrapper = mount(PullDialog);
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Pull")!
    .trigger("click");
  wrapper.unmount();
  finish();
  await flushPromises();
  expect(mocks.close).not.toHaveBeenCalled();
});

it("prevents combining squash with a forced merge commit", async () => {
  const wrapper = mount(PullDialog);
  await flushPromises();
  const boxes = wrapper.findAll('input[type="checkbox"]');
  await boxes[3]!.setValue(true);
  expect(boxes[2]!.attributes("disabled")).toBeDefined();
  await boxes[3]!.setValue(false);
  await boxes[2]!.setValue(true);
  expect(boxes[3]!.attributes("disabled")).toBeDefined();
  wrapper.unmount();
});
