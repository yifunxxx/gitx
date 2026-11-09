import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import DiffViewer from "./DiffViewer.vue";
import CodeMirrorDiff from "./CodeMirrorDiff.vue";
import { useDiffStore } from "@/stores/diffStore";

const mocks = vi.hoisted(() => ({ diffFile: vi.fn(), diffFileAt: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => ({ repoPath: "repo", repoId: "repo" }) }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({ activeEditorKind: "welcome" }) }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => ({}) }));
vi.mock("@/composables/useConfirm", () => ({ promptDialog: vi.fn() }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const result = (leftText: string | null = null, rightText: string | null = null) => ({
  path: "new.txt", leftLabel: "HEAD", rightLabel: "Staged", leftText, rightText,
  binary: false, tooLarge: false, hunks: [], encoding: "utf-8", eolMismatch: false,
});
let wrapper: ReturnType<typeof shallowMount>;
let store: ReturnType<typeof useDiffStore>;
beforeEach(async () => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  store = useDiffStore();
  mocks.diffFileAt.mockResolvedValue(result());
  await store.openFileDiff("new.txt", "head", "index", { leftPath: "old.txt" });
  wrapper = shallowMount(DiffViewer, {
    props: { tabId: store.activeId! },
    global: { stubs: {
      Tip: { template: "<div><slot /></div>" },
      Button: { template: "<button><slot /></button>" },
    } },
  });
});
afterEach(() => wrapper.unmount());
async function click(label: string) {
  await wrapper.findAll("button").find((b) => b.text() === label)!.trigger("click");
  await flushPromises();
}

it.each([false, true])("expands an unchanged rename with unified=%s", async (unified) => {
  expect(wrapper.text()).toContain("diff.noDifferences");
  expect(wrapper.findComponent(CodeMirrorDiff).exists()).toBe(false);
  if (unified) await click("diff.unified");
  mocks.diffFileAt.mockResolvedValue(result("+literal\n-tail\n", "+literal\n-tail\n"));
  await click("diff.expandUnchanged");
  const panes = wrapper.findAllComponents(CodeMirrorDiff);
  expect(panes).toHaveLength(unified ? 1 : 2);
  if (unified) expect(panes[0]!.props("hunks")[0].lines).toEqual([" +literal", " -tail"]);
  else expect(panes.map((p) => p.props("text"))).toEqual(["+literal\n-tail\n", "+literal\n-tail\n"]);
  expect(mocks.diffFileAt).toHaveBeenLastCalledWith(expect.objectContaining({ leftPath: "old.txt", includeTexts: true }));
  await click("diff.collapseUnchanged");
  expect(wrapper.findComponent(CodeMirrorDiff).exists()).toBe(false);
});

it("keeps both original sides when ignoring whitespace removes every hunk", async () => {
  mocks.diffFileAt.mockResolvedValue(result("a b\r\n", "ab\n"));
  await store.setIgnoreWhitespace(store.activeId!, "all");
  await click("diff.expandUnchanged");
  expect(wrapper.findAllComponents(CodeMirrorDiff).map((p) => p.props("text"))).toEqual(["a b\n", "ab\n"]);
});

it("shows a loading state while full text is pending, then displays it", async () => {
  let finish!: (value: ReturnType<typeof result>) => void;
  mocks.diffFileAt.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await click("diff.expandUnchanged");
  expect(wrapper.text()).toContain("diff.loading");
  expect(wrapper.findComponent(CodeMirrorDiff).exists()).toBe(false);
  finish(result("same\n", "same\n"));
  await flushPromises();
  expect(wrapper.findAllComponents(CodeMirrorDiff)).toHaveLength(2);
});

it("retains an inline load error and retries full text", async () => {
  mocks.diffFileAt.mockRejectedValueOnce({ message: "missing object" });
  await click("diff.expandUnchanged");
  expect(wrapper.text()).toContain("missing object");
  mocks.diffFileAt.mockResolvedValue(result("same\n", "same\n"));
  await click("diff.retry");
  expect(wrapper.text()).not.toContain("missing object");
  expect(wrapper.findAllComponents(CodeMirrorDiff)).toHaveLength(2);
});

it("does not repeatedly fetch a deliberately missing or empty side", async () => {
  mocks.diffFileAt.mockResolvedValue(result(null, ""));
  await click("diff.expandUnchanged");
  await click("diff.collapseUnchanged");
  await click("diff.expandUnchanged");
  expect(mocks.diffFileAt).toHaveBeenCalledTimes(2);
  expect(wrapper.findAllComponents(CodeMirrorDiff)).toHaveLength(2);
});

it("expands unchanged prefix and suffix in unified mode around a change", async () => {
  mocks.diffFileAt.mockResolvedValue({
    ...result("prefix\nold\nsuffix\n", "prefix\nnew\nsuffix\n"),
    hunks: [{ index: 0, header: "@@ -2 +2 @@", oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ["-old", "+new"] }],
  });
  await click("diff.unified");
  await click("diff.expandUnchanged");
  expect(wrapper.getComponent(CodeMirrorDiff).props("hunks")[0].lines).toEqual([" prefix", "-old", "+new", " suffix"]);
});
