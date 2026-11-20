import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import CompareView from "./CompareView.vue";
import { useCompareStore } from "@/stores/compareStore";

const m = vi.hoisted(() => ({ ws: {} as any, diffRefs: vi.fn(), diffCombined: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => m }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => m.ws }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({}) }));
vi.mock("@/stores/diffStore", () => ({ useDiffStore: () => ({}) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let pinia: ReturnType<typeof createPinia>;
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  m.ws = reactive({ repoPath: "repo", repoId: "repo", isRepo: true, navigationToken: () => 0 });
  m.diffRefs.mockResolvedValue({ left: "a", right: "b", files: [] });
});
afterEach(() => disposePinia(pinia));
function view(tabId: string) {
  return mount(CompareView, {
    props: { tabId },
    global: {
      plugins: [pinia],
      stubs: {
        Splitpanes: { template: "<div><slot /></div>" },
        Pane: { template: "<div><slot /></div>" },
        PathTreeList: true,
        VirtualList: true,
        ViewportDiff: true,
      },
    },
  });
}

it("disables combined read until the comparison revisions are loaded", async () => {
  const response = deferred<any>();
  m.diffRefs.mockReturnValueOnce(response.promise);
  const store = useCompareStore();
  const pending = store.compareVersions("a", "b");
  const wrapper = view(store.tabs[0]!.id);
  const button = () => wrapper.findAll("button").find((b) => b.text().includes("Combined Diff"))!;
  expect(button().attributes("disabled")).toBeDefined();
  await button().trigger("click");
  expect(m.diffCombined).not.toHaveBeenCalled();
  response.resolve({ left: "a", right: "b", files: [] });
  await pending;
  await flushPromises();
  expect(button().attributes("disabled")).toBeUndefined();
});

it("shows combined progress, blocks repeated clicks and recovers after an error", async () => {
  const store = useCompareStore();
  const tab = (await store.compareVersions("a", "b"))!;
  const wrapper = view(tab.id);
  const button = () => wrapper.findAll("button").find((b) => b.text().includes("Combined Diff"))!;
  const response = deferred<any>();
  m.diffCombined.mockReturnValueOnce(response.promise);
  await button().trigger("click");
  await button().trigger("click");
  expect(m.diffCombined).toHaveBeenCalledTimes(1);
  expect(button().attributes("disabled")).toBeDefined();
  expect(button().attributes("aria-busy")).toBe("true");
  expect(wrapper.get('[role="status"]').text()).toBe("Loading combined diff…");
  response.reject(new Error("file unavailable"));
  await flushPromises();
  expect(wrapper.text()).toContain("file unavailable");
  expect(button().attributes("disabled")).toBeUndefined();
  expect(button().attributes("aria-busy")).toBe("false");
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  m.diffCombined.mockResolvedValueOnce({ left: "b", right: "a", files: [] });
  await button().trigger("click");
  await flushPromises();
  expect(wrapper.text()).not.toContain("file unavailable");
  expect(m.diffCombined).toHaveBeenCalledTimes(2);
  expect(button().attributes("disabled")).toBeUndefined();
});
