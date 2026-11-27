import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import ContentSearchDialog from "./ContentSearchDialog.vue";
const m = vi.hoisted(() => ({
  dialog: { value: { id: 1 } },
  workspace: {} as any,
  viewer: {} as any,
  conflicts: {} as any,
  backend: {
    fsStartContentSearch: vi.fn(),
    fsContentSearchPage: vi.fn(),
    fsCancelSearch: vi.fn(),
    fsStopContentSearch: vi.fn(),
    fsReplaceContent: vi.fn(),
  },
  close: vi.fn(),
  refresh: vi.fn(),
  jobs: { begin: vi.fn(), finished: vi.fn(), progress: vi.fn() },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => m.backend }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => m.workspace }));
vi.mock("@/stores/settingsStore", () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock("@/stores/fileViewerStore", () => ({ useFileViewerStore: () => m.viewer }));
vi.mock("@/stores/conflictsStore", () => ({ useConflictsStore: () => m.conflicts }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({ refresh: m.refresh }) }));
vi.mock("@/stores/jobsStore", () => ({
  useJobsStore: () => m.jobs,
}));
vi.mock("@/composables/useDialog", () => ({
  closeDialog: m.close,
  useDialogState: () => m.dialog,
}));
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, args?: any) =>
      key === "contentSearch.page" ? `${args.page}/${args.pages}` : key,
  }),
}));
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
  m.dialog.value = { id: 1 };
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
  m.backend.fsStopContentSearch.mockResolvedValue(true);
  m.jobs.begin.mockReturnValue("search");
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

it("stops scanning without losing found pages or permitting replacement", async () => {
  let discarded = false;
  m.backend.fsContentSearchPage.mockImplementation(async ({ page }) => {
    if (discarded) throw new Error("Search expired; search again");
    return response({ total: 601, done: false, matches: [match(`page-${page}.txt`)] });
  });
  await search();
  const source = m.backend.fsStartContentSearch.mock.lastCall![0];
  m.backend.fsCancelSearch.mockImplementation(async () => {
    discarded = true;
  });
  m.backend.fsStopContentSearch.mockImplementation(async () => {
    m.backend.fsContentSearchPage.mockImplementation(async ({ page }) =>
      response({ total: 601, matches: [match(`page-${page}.txt`)] }),
    );
    return true;
  });
  await button("common.cancel").trigger("click");
  await flushPromises();
  await wrapper.get('button[aria-label="contentSearch.nextPage"]').trigger("click");
  await flushPromises();
  expect(wrapper.text()).not.toContain("Search expired");
  expect(wrapper.text()).toContain("page-1.txt");
  expect(m.backend.fsContentSearchPage).toHaveBeenLastCalledWith(
    expect.objectContaining({ generation: source.generation, page: 1 }),
  );
  expect(m.backend.fsStopContentSearch).toHaveBeenCalledOnce();
  expect(m.backend.fsStartContentSearch).toHaveBeenCalledOnce();
  expect(button("contentSearch.replaceFiles").attributes("disabled")).toBeDefined();
  expect(wrapper.text()).toContain("contentSearch.stopped");
});

it("keeps the displayed page stable, marks it busy and blocks stale row actions while loading", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 601 }));
  await search();
  const pending = deferred();
  m.backend.fsContentSearchPage.mockReturnValueOnce(pending.promise);
  await wrapper.get('button[aria-label="contentSearch.nextPage"]').trigger("click");
  expect(wrapper.get(".search-pagination").text()).toContain("1/4");
  expect(wrapper.get('[role="listbox"]').attributes("aria-busy")).toBe("true");
  expect(wrapper.get('[role="option"]').attributes("disabled")).toBeDefined();
  await wrapper.get("[data-search-query]").trigger("keydown", { key: "Enter" });
  expect(m.viewer.open).not.toHaveBeenCalled();
  pending.resolve(response({ total: 601, matches: [match("page-two.txt")] }));
  await flushPromises();
  expect(wrapper.get(".search-pagination").text()).toContain("2/4");
  expect(wrapper.text()).toContain("page-two.txt");
  expect(wrapper.get('[role="option"]').attributes("disabled")).toBeUndefined();
});

it("retains the current page after a failed page read and retries that page without rescanning", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 601 }));
  await search();
  m.backend.fsContentSearchPage.mockRejectedValueOnce(new Error("page unavailable"));
  await wrapper.get('button[aria-label="contentSearch.nextPage"]').trigger("click");
  await flushPromises();
  expect(wrapper.get(".search-pagination").text()).toContain("1/4");
  expect(wrapper.get('[role="alert"]').text()).toContain("page unavailable");
  expect(wrapper.get('[role="option"]').attributes("disabled")).toBeUndefined();
  m.backend.fsContentSearchPage.mockResolvedValueOnce(
    response({ total: 601, matches: [match("retried.txt")] }),
  );
  await button("common.retry").trigger("click");
  await flushPromises();
  expect(wrapper.get(".search-pagination").text()).toContain("2/4");
  expect(wrapper.text()).toContain("retried.txt");
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(m.backend.fsStartContentSearch).toHaveBeenCalledOnce();
});

it("keeps one page request in flight when the next-page button is clicked repeatedly", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 601 }));
  await search();
  const pending = deferred();
  m.backend.fsContentSearchPage.mockReturnValue(pending.promise);
  const next = wrapper.get('button[aria-label="contentSearch.nextPage"]');
  await next.trigger("click");
  await next.trigger("click");
  expect(m.backend.fsContentSearchPage).toHaveBeenCalledTimes(2);
  pending.resolve(response({ total: 601 }));
  await flushPromises();
});

it("cancels a debounced search without creating a retained session", async () => {
  await wrapper.get("[data-search-query]").setValue("hit");
  await button("common.cancel").trigger("click");
  await vi.advanceTimersByTimeAsync(300);
  expect(m.backend.fsStartContentSearch).not.toHaveBeenCalled();
  expect(m.backend.fsStopContentSearch).not.toHaveBeenCalled();
  expect(wrapper.text()).toContain("fileSearch.stopped");
});

it("ignores an old page after a new query and restores navigation for the new results", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 601 }));
  await search();
  const pending = deferred();
  m.backend.fsContentSearchPage.mockReturnValueOnce(pending.promise);
  await wrapper.get('button[aria-label="contentSearch.nextPage"]').trigger("click");
  await search("new");
  pending.resolve(response({ total: 601, matches: [match("old-page.txt")] }));
  await flushPromises();
  expect(wrapper.text()).not.toContain("old-page.txt");
  expect(wrapper.get(".search-pagination").text()).toContain("1/4");
  expect(wrapper.get('[role="option"]').attributes("disabled")).toBeUndefined();
});

it("waits for a stopped scan to finish before ending its job and retains the final partial page", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 601, done: false }));
  await search();
  m.jobs.finished.mockClear();
  await button("common.cancel").trigger("click");
  await flushPromises();
  expect(m.jobs.finished).not.toHaveBeenCalled();
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 201, done: true }));
  await vi.advanceTimersByTimeAsync(150);
  await flushPromises();
  expect(m.jobs.finished).toHaveBeenCalledWith("search");
  expect(wrapper.get(".search-pagination").text()).toContain("1/2");
  expect(wrapper.text()).toContain("contentSearch.stopped");
});

it("drops a late stop completion after a new query starts", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 601, done: false }));
  await search();
  const pending = deferred();
  m.backend.fsStopContentSearch.mockReturnValueOnce(pending.promise);
  await button("common.cancel").trigger("click");
  m.backend.fsContentSearchPage.mockResolvedValue(response({ matches: [match("new-query.txt")] }));
  await search("new");
  pending.resolve(true);
  await flushPromises();
  expect(wrapper.text()).toContain("new-query.txt");
  expect(wrapper.text()).not.toContain("contentSearch.stopped");
  expect(button("contentSearch.replaceFiles").attributes("disabled")).toBeUndefined();
});

it.each([true, false])(
  "settles a stop that overtakes the start response (retained=%s)",
  async (retained) => {
    const pending = deferred();
    m.backend.fsStartContentSearch.mockReturnValueOnce(pending.promise);
    await search();
    m.backend.fsStopContentSearch.mockResolvedValueOnce(retained);
    await button("common.cancel").trigger("click");
    await flushPromises();
    expect(m.jobs.finished).toHaveBeenCalledOnce();
    pending.resolve(null);
    await flushPromises();
    expect(m.backend.fsContentSearchPage).toHaveBeenCalledTimes(retained ? 1 : 0);
    expect(m.jobs.finished).toHaveBeenCalledOnce();
    expect(button("contentSearch.replaceFiles").attributes("disabled")).toBeDefined();
  },
);

it("allows retrying a failed stop without ending the running job", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 601, done: false }));
  await search();
  m.backend.fsStopContentSearch.mockRejectedValueOnce(new Error("stop unavailable"));
  await button("common.cancel").trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("stop unavailable");
  expect(m.jobs.finished).not.toHaveBeenCalled();
  expect(button("common.cancel").attributes("disabled")).toBeUndefined();
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 601 }));
  await button("common.cancel").trigger("click");
  await flushPromises();
  expect(m.backend.fsStopContentSearch).toHaveBeenCalledTimes(2);
  expect(m.jobs.finished).toHaveBeenCalledOnce();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
});

it("moves to the last surviving page when stopping removes unfinished file matches", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 601, done: false }));
  await search();
  for (let i = 0; i < 3; i++) {
    await wrapper.get('button[aria-label="contentSearch.nextPage"]').trigger("click");
    await flushPromises();
  }
  expect(wrapper.get(".search-pagination").text()).toContain("4/4");
  m.backend.fsContentSearchPage.mockImplementation(async ({ page }) =>
    response({ total: 201, matches: page === 1 ? [match("last-complete.txt")] : [] }),
  );
  await button("common.cancel").trigger("click");
  await flushPromises();
  expect(wrapper.get(".search-pagination").text()).toContain("2/2");
  expect(wrapper.text()).toContain("last-complete.txt");
  expect(m.backend.fsContentSearchPage.mock.lastCall![0].page).toBe(1);
  expect(m.jobs.finished).toHaveBeenCalledOnce();
});

it("resumes progress polling after a failed stop even if the start response arrived during it", async () => {
  const start = deferred();
  let failStop!: (error: Error) => void;
  m.backend.fsStartContentSearch.mockReturnValueOnce(start.promise);
  m.backend.fsStopContentSearch.mockReturnValueOnce(
    new Promise((_, reject) => {
      failStop = reject;
    }),
  );
  await search();
  await button("common.cancel").trigger("click");
  start.resolve(null);
  await flushPromises();
  expect(m.backend.fsContentSearchPage).not.toHaveBeenCalled();
  failStop(new Error("stop failed"));
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain("stop failed");
  await vi.advanceTimersByTimeAsync(150);
  await flushPromises();
  expect(m.backend.fsContentSearchPage).toHaveBeenCalledOnce();
  expect(m.jobs.finished).toHaveBeenCalledOnce();
  expect(button("contentSearch.replaceFiles").attributes("disabled")).toBeUndefined();
});

it("can retry a failed final stopped-page read and finish the job", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 601, done: false }));
  await search();
  m.backend.fsContentSearchPage.mockRejectedValueOnce(new Error("read failed"));
  await button("common.cancel").trigger("click");
  await flushPromises();
  expect(m.jobs.finished).not.toHaveBeenCalled();
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 201 }));
  await button("common.retry").trigger("click");
  await flushPromises();
  expect(wrapper.get(".search-pagination").text()).toContain("1/2");
  expect(m.jobs.finished).toHaveBeenCalledOnce();
  expect(button("contentSearch.replaceFiles").attributes("disabled")).toBeDefined();
});

it("keeps one poll loop when start completes after a failed stop", async () => {
  const start = deferred();
  m.backend.fsStartContentSearch.mockReturnValueOnce(start.promise);
  m.backend.fsContentSearchPage.mockResolvedValue(response({ done: false }));
  m.backend.fsStopContentSearch.mockRejectedValueOnce(new Error("stop failed"));
  await search();
  await button("common.cancel").trigger("click");
  await flushPromises();
  await vi.advanceTimersByTimeAsync(50);
  start.resolve(null);
  await flushPromises();
  expect(m.backend.fsContentSearchPage).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(149);
  expect(m.backend.fsContentSearchPage).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(m.backend.fsContentSearchPage).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(150);
  expect(m.backend.fsContentSearchPage).toHaveBeenCalledTimes(3);
});

it("releases retained results on unmount and never resumes polling after a late stop", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 601, done: false }));
  await search();
  const source = m.backend.fsStartContentSearch.mock.lastCall![0];
  const pending = deferred();
  m.backend.fsStopContentSearch.mockReturnValueOnce(pending.promise);
  await button("common.cancel").trigger("click");
  wrapper.unmount();
  expect(m.backend.fsCancelSearch).toHaveBeenLastCalledWith({
    sessionId: source.sessionId,
    generation: source.generation,
  });
  pending.resolve(true);
  await vi.advanceTimersByTimeAsync(1000);
  await flushPromises();
  expect(m.backend.fsContentSearchPage).toHaveBeenCalledOnce();
  expect(m.jobs.finished).toHaveBeenCalledOnce();
});

function focusButton(text: string) {
  const target = button(text);
  (target.element as HTMLButtonElement).focus();
  expect(document.activeElement).toBe(target.element);
  return target;
}
function pressFocusedEscape() {
  document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
}
it("keeps keyboard focus inside the dialog when Search again removes its focused button", async () => {
  await search();
  await focusButton("contentSearch.refresh").trigger("click");
  expect(document.activeElement).toBe(wrapper.get("[data-search-query]").element);
  pressFocusedEscape();
  expect(m.close).toHaveBeenCalledWith(null, 1);
});
it("keeps keyboard focus when the footer search button becomes disabled", async () => {
  await wrapper.setProps({ replace: false });
  // The mode is initialized by the prop; use its normal mode switch for this mounted dialog.
  await wrapper.get('.search-modes button[aria-pressed="false"]').trigger("click");
  await search();
  await focusButton("contentSearch.search").trigger("click");
  expect(document.activeElement).toBe(wrapper.get("[data-search-query]").element);
  pressFocusedEscape();
  expect(m.close).toHaveBeenCalledWith(null, 1);
});
it("recovers focus when a scan finishes while its stop button has keyboard focus", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ done: false }));
  await search();
  focusButton("common.cancel");
  m.backend.fsContentSearchPage.mockResolvedValue(response());
  await vi.advanceTimersByTimeAsync(150);
  expect(document.activeElement).toBe(wrapper.get("[data-search-query]").element);
  pressFocusedEscape();
  expect(m.close).toHaveBeenCalledWith(null, 1);
});
it("recovers focus when stop disables its button and keeps it after the scan settles", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ done: false }));
  await search();
  const stop = deferred();
  m.backend.fsStopContentSearch.mockReturnValueOnce(stop.promise);
  await focusButton("common.cancel").trigger("click");
  expect(document.activeElement).toBe(wrapper.get("[data-search-query]").element);
  m.backend.fsContentSearchPage.mockResolvedValue(response());
  stop.resolve(true);
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.get("[data-search-query]").element);
});
it("recovers page-button focus without stealing subsequent include-field focus", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ total: 601 }));
  await search();
  const page = deferred();
  m.backend.fsContentSearchPage.mockReturnValueOnce(page.promise);
  const next = wrapper.get('button[aria-label="contentSearch.nextPage"]');
  (next.element as HTMLButtonElement).focus();
  await next.trigger("click");
  expect(document.activeElement).toBe(wrapper.get("[data-search-query]").element);
  const include = wrapper.get('input[aria-label="contentSearch.include"]')
    .element as HTMLInputElement;
  include.focus();
  page.resolve(response({ total: 601 }));
  await flushPromises();
  expect(document.activeElement).toBe(include);
});
it("recovers retry focus when the failed page starts loading", async () => {
  m.backend.fsContentSearchPage.mockRejectedValueOnce(new Error("unavailable"));
  await search();
  const page = deferred();
  m.backend.fsContentSearchPage.mockReturnValueOnce(page.promise);
  await focusButton("common.retry").trigger("click");
  expect(document.activeElement).toBe(wrapper.get("[data-search-query]").element);
  page.resolve(response());
  await flushPromises();
  pressFocusedEscape();
  expect(m.close).toHaveBeenCalledWith(null, 1);
});
it("keeps focus on a stable dialog while replacement disables all query controls", async () => {
  await search();
  await button("contentSearch.replaceFiles").trigger("click");
  const replace = deferred();
  m.backend.fsReplaceContent.mockReturnValueOnce(replace.promise);
  await focusButton("contentSearch.confirmReplace").trigger("click");
  expect(wrapper.get('[role="dialog"]').element.contains(document.activeElement)).toBe(true);
  expect(document.activeElement?.matches(":disabled")).toBe(false);
  pressFocusedEscape();
  expect(m.close).not.toHaveBeenCalled();
  replace.resolve({ completed: [], failed: [] });
  await flushPromises();
  pressFocusedEscape();
  expect(m.close).toHaveBeenCalledWith(null, 1);
});
it("does not take focus from a newer dialog when a hidden search completes", async () => {
  m.backend.fsContentSearchPage.mockResolvedValue(response({ done: false }));
  await search();
  focusButton("common.cancel");
  const child = document.createElement("input");
  document.body.append(child);
  child.focus();
  m.dialog.value = { id: 2 };
  m.backend.fsContentSearchPage.mockResolvedValue(response());
  await vi.advanceTimersByTimeAsync(150);
  expect(document.activeElement).toBe(child);
  child.remove();
});
