import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import CustomContextMenuHost from "./CustomContextMenuHost.vue";

const mocks = vi.hoisted(() => ({ ws: {} as any, changes: {} as any, run: vi.fn() }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/actions/titles", () => ({ resolveActionTitle: () => "Stage" }));
vi.mock("@/actions", () => ({
  getGroup: () => ({ children: ["stage"] }),
  getAction: () => ({ id: "stage" }),
  runAction: mocks.run,
  shortcutFor: () => [],
  isEnabled: () => true,
  isVisible: () => true,
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
let wrapper: ReturnType<typeof mount>;
let surface: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ws = reactive({
    repoPath: "A",
    repoId: "A",
    folderPath: "A",
    isRepo: true,
    generation: 1,
    navigationToken() {
      return this.generation;
    },
  });
  mocks.changes = reactive({
    selectedPaths: ["first.txt"],
    selectedSection: "unstaged",
    stagingMode: true,
  });
  surface = document.createElement("div");
  surface.dataset.gitxContext = "changes";
  document.body.append(surface);
  wrapper = mount(CustomContextMenuHost, { attachTo: document.body });
});
afterEach(() => {
  wrapper.unmount();
  surface.remove();
});
async function openMenu() {
  surface.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  await flushPromises();
  return document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
}
it("dispatches the context's files and repository", async () => {
  (await openMenu()).click();
  expect(mocks.run).toHaveBeenCalledWith(
    "stage",
    expect.objectContaining({
      repoIds: ["A"],
      selection: { files: ["first.txt"] },
    }),
  );
});

it("preserves the action's checked-file fallback when the context has no selected files", async () => {
  mocks.changes.selectedPaths = [];
  (await openMenu()).click();
  expect(mocks.run).toHaveBeenCalledWith("stage", expect.objectContaining({
    selection: { files: undefined },
  }));
});
it.each(["navigation", "selection"])("closes on %s and ignores a queued click", async (kind) => {
  const button = await openMenu();
  if (kind === "navigation") mocks.ws.generation++;
  else mocks.changes.selectedPaths.push("other.txt");
  button.click();
  await flushPromises();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(mocks.run).not.toHaveBeenCalled();
});
