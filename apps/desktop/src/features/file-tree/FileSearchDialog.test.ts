import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import FileSearchDialog from "./FileSearchDialog.vue";
const mocks = vi.hoisted(() => ({
  workspace: {} as any,
  settings: {} as any,
  fsSearchFiles: vi.fn(),
  fsCancelSearch: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => ({ open: mocks.open }) }));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: mocks.close,
  useDialogState: () => ({ value: { id: 8 } }),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
let wrapper: VueWrapper;
const response = (path: string) => ({
  matches: [{ path, score: 0 }],
  scanned: 20,
  skipped: 0,
  truncated: false,
});
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  mocks.workspace = reactive({
    folderPath: "C:/plain",
    token: 1,
    navigationToken() {
      return this.token;
    },
  });
  mocks.settings = reactive({
    settings: { showHiddenInFileTree: false, showIgnoredInFileTree: true },
  });
  mocks.fsCancelSearch.mockResolvedValue(null);
  mocks.fsSearchFiles.mockResolvedValue(response("nested/file.txt"));
  wrapper = mount(FileSearchDialog, { attachTo: document.body });
});
afterEach(() => {
  wrapper.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function query(value: string) {
  await wrapper.get('input[type="search"]').setValue(value);
  await vi.advanceTimersByTimeAsync(180);
  await flushPromises();
}

it("searches unopened workspace paths and opens the selected result with Enter", async () => {
  await query("nfl");
  expect(mocks.fsSearchFiles).toHaveBeenCalledWith(
    expect.objectContaining({
      folderPath: "C:/plain",
      query: "nfl",
      showHidden: false,
      showIgnored: true,
    }),
  );
  expect(wrapper.text()).toContain("nested/file.txt");
  await wrapper.get("input").trigger("keydown", { key: "Enter" });
  await flushPromises();
  expect(mocks.open).toHaveBeenCalledWith("nested/file.txt", { folderPath: "C:/plain" });
  expect(mocks.close).toHaveBeenCalledWith(null, 8);
});

it("cancels the previous request and ignores its delayed completion", async () => {
  const old = deferred();
  mocks.fsSearchFiles.mockReturnValueOnce(old.promise);
  await query("old");
  await query("new");
  old.resolve(response("old.txt"));
  await flushPromises();
  expect(wrapper.text()).toContain("nested/file.txt");
  expect(wrapper.text()).not.toContain("old.txt");
  expect(mocks.fsCancelSearch).toHaveBeenCalledTimes(2);
});

it("shows scan limits and errors without claiming no matches", async () => {
  mocks.fsSearchFiles.mockResolvedValueOnce({ ...response("file"), truncated: true, skipped: 2 });
  await query("file");
  expect(wrapper.text()).toContain("fileSearch.limited");
  expect(wrapper.text()).toContain("fileSearch.skipped");
  mocks.fsSearchFiles.mockRejectedValueOnce(new Error("folder unavailable"));
  await query("other");
  expect(wrapper.get('[role="alert"]').text()).toContain("folder unavailable");
  expect(wrapper.text()).not.toContain("fileSearch.empty");
});

it("closes on workspace navigation and cancels on disposal", async () => {
  const pending = deferred();
  mocks.fsSearchFiles.mockReturnValueOnce(pending.promise);
  await query("file");
  mocks.workspace.token++;
  await flushPromises();
  expect(mocks.close).toHaveBeenCalledWith(null, 8);
  wrapper.unmount();
  pending.resolve(response("stale"));
  await flushPromises();
  expect(mocks.fsCancelSearch).toHaveBeenCalledTimes(2);
});

it("changing visibility cancels and reruns the search with the new settings", async () => {
  await query("file");
  mocks.settings.settings.showHiddenInFileTree = true;
  await vi.advanceTimersByTimeAsync(180);
  await flushPromises();
  expect(mocks.fsSearchFiles.mock.lastCall?.[0].showHidden).toBe(true);
});
it("searches saved content with case preference and navigates to its line and column", async () => {
  wrapper.unmount();
  wrapper = mount(FileSearchDialog, { props: { content: true }, attachTo: document.body });
  mocks.fsSearchFiles.mockResolvedValue({
    ...response("deep/a.txt"),
    matches: [{ path: "deep/a.txt", score: 0, line: 22, column: 5, preview: "a matching line" }],
  });
  await wrapper.get('input[type="checkbox"]').setValue(true);
  await query("matching");
  expect(mocks.fsSearchFiles.mock.lastCall?.[0]).toMatchObject({
    content: true,
    caseSensitive: true,
  });
  expect(wrapper.text()).toContain("deep/a.txt:22:5");
  expect(wrapper.text()).toContain("a matching line");
  await wrapper.get('input[type="search"]').trigger("keydown", { key: "Enter" });
  await flushPromises();
  expect(mocks.open).toHaveBeenCalledWith("deep/a.txt", {
    folderPath: "C:/plain",
    line: 22,
    column: 5,
  });
});
