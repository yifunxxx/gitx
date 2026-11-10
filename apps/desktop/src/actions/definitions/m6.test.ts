import { beforeEach, expect, it, vi } from "vitest";
import { registerM6Actions } from "./m6";
import { getAction } from "../registry";
import type { ActionContext } from "../types";
const mocks = vi.hoisted(() => ({
  ws: {} as any,
  changes: {} as any,
  prompt: vi.fn(),
  patch: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/stores/workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("@/stores/changesStore", () => ({ useChangesStore: () => mocks.changes }));
vi.mock("@/stores/layoutStore", () => ({ useLayoutStore: () => ({}) }));
vi.mock("@/stores/stashShelfStore", () => ({ useStashShelfStore: () => ({}) }));
vi.mock("@/composables/useConfirm", () => ({ promptDialog: mocks.prompt }));
vi.mock("@/composables/useToast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/backend", () => ({ getBackend: () => ({ patchCreate: mocks.patch }) }));
const context: ActionContext = {
  repoIds: ["A"],
  source: "context",
  place: "Git.ContextMenu.Changes",
  selection: {},
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.ws = {
    repoPath: "A",
    folderPath: "A",
    isRepo: true,
    generation: 1,
    navigationToken() {
      return this.generation;
    },
  };
  mocks.changes = {
    selectedPaths: ["other.txt"],
    checkedPaths: ["checked.txt"],
    createChangelist: vi.fn().mockResolvedValue({ lists: [] }),
  };
  mocks.patch.mockResolvedValue({ path: "patch", bytes: 10 });
  registerM6Actions();
});
it.each([{ files: ["menu.txt"] }, { files: [] }])(
  "honors an explicit patch selection $files",
  async ({ files }) => {
    await getAction("Create Patch")!.run({ ...context, selection: { files } });
    expect(mocks.patch).toHaveBeenCalledWith(expect.objectContaining({ path: "A", paths: files }));
  },
);
it("uses selected files when a non-menu patch command has no explicit files", async () => {
  await getAction("Create Patch")!.run(context);
  expect(mocks.patch).toHaveBeenCalledWith(expect.objectContaining({ paths: ["other.txt"] }));
});

it("uses checked files when there is no explicit or current selection", async () => {
  mocks.changes.selectedPaths = [];
  await getAction("Create Patch")!.run(context);
  expect(mocks.patch).toHaveBeenCalledWith(expect.objectContaining({ paths: ["checked.txt"] }));
});
it("does not create a list in another repository after its naming dialog", async () => {
  let resolve!: (value: string) => void;
  mocks.prompt.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  const pending = getAction("ChangesView.NewChangeList")!.run(context);
  mocks.ws.generation += 2;
  resolve("list");
  await pending;
  expect(mocks.changes.createChangelist).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
});
