import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import DialogHost from "@/components/common/DialogHost.vue";
import { closeDialog, openDialog, useDialogStack } from "@/composables/useDialog";
import { withBackendActivity } from "@/lib/backend/activity";
import { useJobsStore } from "@/stores/jobsStore";
import { i18n } from "@/i18n";
import CompareBranchesDialog from "./CompareBranchesDialog.vue";
import type { CompareRange } from "@/lib/backend";

const mocks = vi.hoisted(() => ({
  ws: {} as { repoPath: string; repoId: string; isRepo: boolean; generation: number; navigationToken(): number },
  compare: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/lib/backend", () => ({ getBackend: () => withBackendActivity({ compareBranches: mocks.compare }) }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const comparison = (prefix: string, left = "main", right = "topic"): CompareRange => ({
  left, right, leftOnly: [`${prefix}-only-in-${right}`], rightOnly: [`${prefix}-only-in-${left}`],
});
let pinia: ReturnType<typeof createPinia>;
let host: ReturnType<typeof mount>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  pinia = createPinia(); setActivePinia(pinia); i18n.global.locale.value = "en";
  mocks.ws = reactive({ repoPath: "A", repoId: "A", isRepo: true, generation: 0,
    navigationToken() { return this.generation; },
  });
  host = mount(DialogHost, { attachTo: document.body, global: { plugins: [pinia, i18n] } });
});
afterEach(() => { host.unmount(); disposePinia(pinia); vi.unstubAllGlobals(); });
async function fixture() {
  const result = openDialog(CompareBranchesDialog, { left: "main", right: "topic" });
  await flushPromises();
  const view = host.getComponent(CompareBranchesDialog);
  const id = useDialogStack().value.at(-1)!.id;
  return { view, id, result };
}
const button = (view: Awaited<ReturnType<typeof fixture>>["view"], label: string) => view.findAll("button").find(b => b.text() === label)!;

it("keeps the backend range convention and shows both unique commit lists", async () => {
  mocks.compare.mockResolvedValue(comparison("fresh"));
  const { view } = await fixture();
  expect(mocks.compare).toHaveBeenCalledExactlyOnceWith({ path: "A", left: "main", right: "topic" });
  expect(view.text()).toContain("In topic not in main");
  expect(view.text()).toContain("fresh-only-in-topic");
  expect(view.text()).toContain("fresh-only-in-main");
});

it.each(["success", "error"])("ignores an older %s after Swap completes", async (outcome) => {
  const old = deferred<CompareRange>(), latest = deferred<CompareRange>();
  mocks.compare.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const { view } = await fixture();
  await button(view, "Swap").trigger("click");
  latest.resolve(comparison("latest", "topic", "main")); await flushPromises();
  if (outcome === "success") old.resolve(comparison("stale")); else old.reject(new Error("stale failure"));
  await flushPromises();
  expect(view.text()).toContain("latest-only-in-main");
  expect(view.text()).not.toContain("stale");
});

it("clears prior results while a new direction is loading and tracks pending work", async () => {
  const pending = deferred<CompareRange>();
  mocks.compare.mockResolvedValueOnce(comparison("old")).mockReturnValueOnce(pending.promise);
  const jobs = useJobsStore();
  const { view } = await fixture();
  await button(view, "Swap").trigger("click");
  expect(view.text()).not.toContain("old-only");
  expect(view.get('[role="status"]').text()).toContain("Comparing");
  expect(jobs.count).toBe(1);
  expect(jobs.running[0]).toMatchObject({ message: "A", cancellable: false });
  pending.resolve(comparison("new", "topic", "main")); await flushPromises();
  expect(view.find('[role="status"]').exists()).toBe(false); expect(jobs.count).toBe(0);
});

it("does not clear latest loading when an older request finishes", async () => {
  const old = deferred<CompareRange>(), latest = deferred<CompareRange>();
  mocks.compare.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const { view } = await fixture();
  await button(view, "Swap").trigger("click");
  old.resolve(comparison("old")); await flushPromises();
  expect(view.get('[role="status"]').text()).toContain("Comparing");
  expect(view.text()).not.toContain("old-only");
  latest.resolve(comparison("new", "topic", "main")); await flushPromises();
  expect(view.find('[role="status"]').exists()).toBe(false);
});

it("clears a previous error on a successful Swap", async () => {
  mocks.compare.mockRejectedValueOnce(new Error("first failed")).mockResolvedValueOnce(comparison("new", "topic", "main"));
  const { view } = await fixture();
  await button(view, "Swap").trigger("click"); await flushPromises();
  expect(view.text()).not.toContain("first failed");
  expect(view.text()).toContain("new-only-in-main");
});

it("offers Retry for the same direction after a failure", async () => {
  mocks.compare.mockRejectedValueOnce(new Error("locked")).mockResolvedValueOnce(comparison("new"));
  const { view } = await fixture();
  expect(view.get('[role="alert"]').text()).toContain("locked");
  await button(view, "Retry").trigger("click"); await flushPromises();
  expect(mocks.compare.mock.calls[1]![0]).toEqual({ path: "A", left: "main", right: "topic" });
  expect(view.text()).toContain("new-only-in-topic");
});

it.each(["repository", "navigation", "identity", "non-repository"])("closes and rejects an old Swap after %s changes", async (kind) => {
  const pending = deferred<CompareRange>(); mocks.compare.mockReturnValue(pending.promise);
  const { view, id } = await fixture();
  if (kind === "repository") mocks.ws.repoPath = "B";
  if (kind === "navigation") ++mocks.ws.generation;
  if (kind === "identity") mocks.ws.repoId = "replacement";
  if (kind === "non-repository") mocks.ws.isRepo = false;
  await button(view, "Swap").trigger("click"); await flushPromises();
  expect(mocks.compare).toHaveBeenCalledOnce();
  expect(useDialogStack().value.some(d => d.id === id)).toBe(false);
  pending.resolve(comparison("late")); await flushPromises();
});

it.each(["success", "error"])("allows Escape during a read and drains a late %s without touching a replacement", async (outcome) => {
  const pending = deferred<CompareRange>(); mocks.compare.mockReturnValue(pending.promise);
  const jobs = useJobsStore();
  const { view, result } = await fixture();
  expect(jobs.count).toBe(1);
  await button(view, "Close").trigger("keydown", { key: "Escape" });
  await flushPromises(); expect(await result).toBeNull();
  const other = openDialog({ template: '<div>Other</div>' }); await flushPromises();
  const id = useDialogStack().value.at(-1)!.id;
  if (outcome === "success") pending.resolve(comparison("late")); else pending.reject(new Error("old failure"));
  await flushPromises();
  expect(useDialogStack().value.map(d => d.id)).toEqual([id]); expect(jobs.count).toBe(0);
  closeDialog(null, id); await other;
});
