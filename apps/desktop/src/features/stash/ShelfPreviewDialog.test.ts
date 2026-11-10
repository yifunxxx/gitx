import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import ShelfPreviewDialog from "./ShelfPreviewDialog.vue";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), close: vi.fn(), workspace: {} as any }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ shelfPreview: mocks.preview }) }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: mocks.close,
  useDialogState: () => ({ value: { id: 42 } }),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
enableAutoUnmount(afterEach);
const result = {
  entry: { message: "saved", binary: false },
  patch: "-old\n+saved",
  lossy: false,
  truncated: false,
};
function deferred() {
  let resolve!: (value: any) => void, reject!: (error: any) => void;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const create = (deleted = false) =>
  mount(ShelfPreviewDialog, {
    props: { path: "A", id: "s1", deleted, navigation: 3, message: "name" },
    global: {
      stubs: { ShelfPatchView: { props: ["text"], template: "<pre data-patch>{{ text }}</pre>" } },
    },
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace = reactive({
    repoPath: "A",
    token: 3,
    navigationToken() {
      return this.token;
    },
  });
});
it.each([false, true])(
  "loads the saved active/deleted snapshot (%s) and labels limits",
  async (deleted) => {
    const read = deferred();
    mocks.preview.mockReturnValue(read.promise);
    const wrapper = create(deleted);
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe("common.loading");
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith({ path: "A", id: "s1", deleted });
    read.resolve({
      ...result,
      lossy: true,
      truncated: true,
      entry: { message: "saved", binary: true },
    });
    await flushPromises();
    expect(wrapper.get("[data-patch]").text()).toBe(result.patch);
    expect(wrapper.text()).toContain("shelf.previewTruncated");
    expect(wrapper.text()).toContain("shelf.previewLossy");
    expect(wrapper.text()).toContain("shelf.previewBinary");
    expect(wrapper.text().includes("shelf.recentlyDeleted")).toBe(deleted);
  },
);
it("retries a failed read once while keeping the original request", async () => {
  mocks.preview.mockRejectedValueOnce(new Error("missing saved patch"));
  const wrapper = create();
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("missing saved patch");
  const read = deferred();
  mocks.preview.mockReturnValue(read.promise);
  const retry = wrapper.findAll("button").find((b) => b.text() === "diff.retry")!;
  await retry.trigger("click");
  await retry.trigger("click");
  expect(mocks.preview).toHaveBeenCalledTimes(2);
  read.resolve(result);
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.get("[data-patch]").text()).toBe(result.patch);
});
it.each(["path", "same-path"])(
  "closes only its dialog on %s navigation and ignores late reads",
  async (kind) => {
    const read = deferred();
    mocks.preview.mockReturnValue(read.promise);
    const wrapper = create();
    if (kind === "path") mocks.workspace.repoPath = "B";
    else mocks.workspace.token++;
    await flushPromises();
    expect(mocks.close).toHaveBeenCalledWith(null, 42);
    read.resolve(result);
    await flushPromises();
    expect(wrapper.find("[data-patch]").exists()).toBe(false);
  },
);
it("does not start a read after navigation before the async dialog mounts", async () => {
  mocks.workspace.token++;
  create();
  await flushPromises();
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledWith(null, 42);
});
it("discards late failure after explicit close or unmount", async () => {
  const read = deferred();
  mocks.preview.mockReturnValue(read.promise);
  const wrapper = create();
  await wrapper.get("button").trigger("click");
  read.reject(new Error("late"));
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(null, 42);
  wrapper.unmount();
});
it("shows an empty snapshot without inventing working changes", async () => {
  mocks.preview.mockResolvedValue({ ...result, patch: "" });
  const wrapper = create();
  await flushPromises();
  expect(wrapper.text()).toContain("shelf.noPatchChanges");
  expect(wrapper.find("[data-patch]").exists()).toBe(false);
});
