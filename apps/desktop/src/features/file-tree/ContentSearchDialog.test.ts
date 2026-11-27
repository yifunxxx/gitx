import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import ContentSearchDialog from "./ContentSearchDialog.vue";
const m = vi.hoisted(() => ({
  workspace: {} as any,
  viewer: {} as any,
  conflicts: {} as any,
  backend: {
    fsStartContentSearch: vi.fn(),
    fsContentSearchPage: vi.fn(),
    fsCancelSearch: vi.fn(),
    fsReplaceContent: vi.fn(),
  },
  close: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m.backend }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => m.workspace }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => m.viewer }));
vi.mock("@/stores/conflictsStore", () => ({ useConflictsStore: () => m.conflicts }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: m.refresh }) }));
vi.mock("@/stores/jobsStore", () => ({
  useJobsStore: () => ({ begin: vi.fn(() => "search"), finished: vi.fn(), progress: vi.fn() }),
}));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: m.close,
  useDialogState: () => ({ value: { id: 1 } }),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
let wrapper: VueWrapper;
const match = (path = "a.txt", column = 1) => ({
  path,
  line: 1,
  column,
  preview: "hit hit",
  matchStart: column - 1,
  matchEnd: column + 2,
  replacementPreview: "new hit",
});
const response = (extra = {}) => ({
  matches: [match(), match("a.txt", 5), match("b.txt")],
  total: 3,
  files: 2,
  scanned: 4,
  skipped: 0,
  issues: [],
  done: true,
  error: null,
  ...extra,
});
function deferred() {
  let resolve!: (v: any) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}
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
  m.workspace = reactive({
    folderPath: "C:/project",
    isRepo: true,
    token: 1,
    navigationToken() {
      return this.token;
    },
  });
  m.viewer = reactive({
    tabs: [],
    fileMutationPending: false,
    affectedByFiles: vi.fn(() => []),
    closeTab: vi.fn(),
    open: vi.fn(),
  });
  m.conflicts = reactive({ busy: false, mergeTabs: [] });
  m.backend.fsCancelSearch.mockResolvedValue(null);
  m.backend.fsStartContentSearch.mockResolvedValue(null);
  m.backend.fsContentSearchPage.mockResolvedValue(response());
  m.backend.fsReplaceContent.mockResolvedValue({ completed: ["a.txt", "b.txt"], failed: [] });
  wrapper = mount(ContentSearchDialog, { props: { replace: true }, attachTo: document.body });
});
afterEach(() => {
  wrapper.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function search(text = "hit") {
  await wrapper.get("[data-search-query]").setValue(text);
  await vi.advanceTimersByTimeAsync(220);
  await flushPromises();
}
const button = (text: string) => wrapper.findAll("button").find((b) => b.text() === text)!;
it("passes every search condition, replacement and include/exclude globs to the same scan", async () => {
  for (const key of ["caseSensitive", "wholeWord", "regex"])
    await wrapper.get(`input[aria-label="contentSearch.${key}"]`).setValue(true);
  await wrapper.get('input[aria-label="contentSearch.include"]').setValue("src/**,*.vue");
  await wrapper.get('input[aria-label="contentSearch.exclude"]').setValue("dist");
  await wrapper.get('input[aria-label="contentSearch.replacement"]').setValue("$1");
  await search("(hit)");
  expect(m.backend.fsStartContentSearch).toHaveBeenLastCalledWith(
    expect.objectContaining({
      query: "(hit)",
      replacement: "$1",
      caseSensitive: true,
      wholeWord: true,
      regex: true,
      include: "src/**,*.vue",
      exclude: "dist",
    }),
  );
  expect(wrapper.findAll("mark")).toHaveLength(3);
});
it("streams a bounded page while scanning and fetches subsequent pages without restarting", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 601, done: false }));
  await search();
  expect(wrapper.findAll('[role="option"]')).toHaveLength(3);
  expect(button("contentSearch.replaceFiles").attributes("disabled")).toBeDefined();
  await wrapper.get('button[aria-label="contentSearch.nextPage"]').trigger("click");
  await flushPromises();
  expect(m.backend.fsContentSearchPage.mock.lastCall?.[0].page).toBe(1);
  expect(m.backend.fsStartContentSearch).toHaveBeenCalledTimes(1);
});
it("ignores late polling responses after a query or page changes", async () => {
  const old = deferred();
  m.backend.fsContentSearchPage.mockReturnValueOnce(old.promise);
  await search("old");
  await search("new");
  old.resolve(response({ matches: [match("old.txt")] }));
  await flushPromises();
  expect(wrapper.text()).not.toContain("old.txt");
  expect(wrapper.text()).toContain("a.txt");
});
it("excludes the whole file across occurrences and requires a concrete replacement confirmation", async () => {
  await search();
  const checks = wrapper.findAll('input[aria-label="contentSearch.selectFile"]');
  await checks[0]!.setValue(false);
  expect((checks[1]!.element as HTMLInputElement).checked).toBe(false);
  await button("contentSearch.replaceFiles").trigger("click");
  expect(m.backend.fsReplaceContent).not.toHaveBeenCalled();
  await button("contentSearch.confirmReplace").trigger("click");
  await flushPromises();
  expect(m.backend.fsReplaceContent).toHaveBeenCalledWith(
    expect.objectContaining({ excludedPaths: ["a.txt"] }),
  );
  expect(wrapper.text()).toContain("contentSearch.replaced");
  expect(m.viewer.fileMutationPending).toBe(false);
});
it("switches find/replace modes without losing the query and requires fresh confirmation after switching", async () => {
  await search();
  await button("contentSearch.replaceFiles").trigger("click");
  expect(wrapper.text()).toContain("contentSearch.confirmReplace");
  await wrapper.get('.search-modes button[aria-pressed="false"]').trigger("click");
  expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe("fileSearch.contentTitle");
  expect(wrapper.find('input[aria-label="contentSearch.replacement"]').exists()).toBe(false);
  expect((wrapper.get("[data-search-query]").element as HTMLInputElement).value).toBe("hit");
  await wrapper.get('.search-modes button[aria-pressed="false"]').trigger("click");
  expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe(
    "contentSearch.replaceTitle",
  );
  expect(wrapper.text()).not.toContain("contentSearch.confirmReplace");
  expect(m.backend.fsStartContentSearch).toHaveBeenCalledTimes(1);
  expect(m.backend.fsReplaceContent).not.toHaveBeenCalled();
  await button("contentSearch.replaceFiles").trigger("click");
  expect(m.backend.fsReplaceContent).not.toHaveBeenCalled();
});
it("keeps mode changes disabled while a replacement is writing", async () => {
  await search();
  const pending = deferred();
  m.backend.fsReplaceContent.mockReturnValueOnce(pending.promise);
  await button("contentSearch.replaceFiles").trigger("click");
  await button("contentSearch.confirmReplace").trigger("click");
  await wrapper.get('.search-modes button[aria-pressed="false"]').trigger("click");
  expect(wrapper.get('[role="dialog"]').attributes("aria-label")).toBe(
    "contentSearch.replaceTitle",
  );
  pending.resolve({ completed: [], failed: [] });
  await flushPromises();
});
it("never replaces with unsaved drafts, pending scans, cancelled scans or changed search options", async () => {
  await search();
  m.viewer.tabs.push({ dirty: true });
  await flushPromises();
  expect(button("contentSearch.replaceFiles").attributes("disabled")).toBeDefined();
  m.viewer.tabs.splice(0);
  await flushPromises();
  await button("contentSearch.replaceFiles").trigger("click");
  await wrapper.get('input[aria-label="contentSearch.replacement"]').setValue("changed");
  expect(wrapper.text()).not.toContain("contentSearch.confirmReplace");
  expect(m.backend.fsReplaceContent).not.toHaveBeenCalled();
});
it("blocks disk replacement while merge buffers or conflict writes are active", async () => {
  await search();
  m.conflicts.mergeTabs.push({ id: "merge:a", path: "a.txt", saving: false });
  await flushPromises();
  expect(button("contentSearch.replaceFiles").attributes("disabled")).toBeDefined();
  m.conflicts.mergeTabs.splice(0);
  m.conflicts.busy = true;
  await flushPromises();
  expect(button("contentSearch.replaceFiles").attributes("disabled")).toBeDefined();
  expect(m.backend.fsReplaceContent).not.toHaveBeenCalled();
  m.conflicts.busy = false;
  await flushPromises();
  expect(button("contentSearch.replaceFiles").attributes("disabled")).toBeUndefined();
});
it("shows stale-file errors, preserves buffers on failure and keeps applying locked until completion", async () => {
  await search();
  const pending = deferred();
  m.backend.fsReplaceContent.mockReturnValueOnce(pending.promise);
  await button("contentSearch.replaceFiles").trigger("click");
  await button("contentSearch.confirmReplace").trigger("click");
  expect(m.viewer.fileMutationPending).toBe(true);
  await wrapper.trigger("keydown", { key: "Escape" });
  expect(m.close).not.toHaveBeenCalled();
  pending.resolve({ completed: [], failed: ["a.txt: changed since search"] });
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("changed since search");
  expect(m.viewer.closeTab).not.toHaveBeenCalled();
});
it("cancels and rejects further result navigation on workspace changes", async () => {
  await search();
  m.workspace.token++;
  await flushPromises();
  expect(m.close).toHaveBeenCalledWith(null, 1);
  await wrapper.find('[role="option"]').trigger("click");
  expect(m.viewer.open).not.toHaveBeenCalled();
});
