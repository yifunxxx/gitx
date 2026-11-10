import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useDiffStore } from "./diffStore";
import { diffViewKey, type DiffPaneSnapshot } from "@/features/diff/diffViewState";

const mocks = vi.hoisted(() => ({
  diffFile: vi.fn(),
  workspace: {} as { repoPath: string; repoId: string },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.workspace }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => ({ activeEditorKind: "diff" }) }));

const result = (text = "first content") => ({
  path: "file.txt",
  leftLabel: "Staged",
  rightLabel: "Local",
  leftText: "original",
  rightText: text,
  hunks: [],
  binary: false,
  tooLarge: false,
  encoding: "utf-8",
  eolMismatch: false,
});

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.workspace = reactive({ repoPath: "A", repoId: "A" });
  mocks.diffFile.mockImplementation(async () => result());
});

async function setup() {
  const store = useDiffStore();
  await store.openFileDiff("file.txt");
  const id = store.activeId!;
  const snapshot: DiffPaneSnapshot = {
    key: diffViewKey(store.tabs[0]!),
    side: "right",
    state: {
      scroll: EditorView.scrollIntoView(5),
      selection: EditorSelection.single(2, 7),
      selectionVisible: true,
      docLength: 13,
    },
  };
  store.savePaneViewState(id, snapshot);
  return { store, id, snapshot };
}

it("restores each pane independently after switching away and back", async () => {
  const { store, id, snapshot } = await setup();
  const left = { ...snapshot.state, selection: EditorSelection.single(1, 3) };
  store.savePaneViewState(id, { ...snapshot, side: "left", state: left });
  await store.openFileDiff("another.txt");
  await store.openFileDiff("file.txt");
  expect(store.getPaneViewState(id, "right")).toBe(snapshot.state);
  expect(store.getPaneViewState(id, "left")).toBe(left);
  expect(store.getPaneViewState(id, "unified")).toBeUndefined();
});

it("keeps positions across an identical refresh and background completion", async () => {
  const { store, id, snapshot } = await setup();
  await store.reloadTab(id);
  await store.openFileDiff("another.txt");
  expect(store.getPaneViewState(id, "right")).toBe(snapshot.state);
});

it("drops positions and rejects outgoing snapshots when content changes", async () => {
  const { store, id, snapshot } = await setup();
  mocks.diffFile.mockResolvedValueOnce(result("other content"));
  await store.reloadTab(id);
  store.savePaneViewState(id, snapshot);
  expect(store.getPaneViewState(id, "right")).toBeUndefined();
});

it("does not resurrect positions when a closed file is reopened", async () => {
  const { store, id, snapshot } = await setup();
  store.closeTab(id);
  store.savePaneViewState(id, snapshot);
  await store.openFileDiff("file.txt");
  store.savePaneViewState(id, snapshot);
  expect(store.getPaneViewState(id, "right")).toBeUndefined();
});

it("clears positions across a repository round trip", async () => {
  const { store, id, snapshot } = await setup();
  mocks.workspace.repoPath = "B";
  mocks.workspace.repoPath = "A";
  await store.openFileDiff("file.txt");
  store.savePaneViewState(id, snapshot);
  expect(store.getPaneViewState(id, "right")).toBeUndefined();
});

it.each(["unified", "expanded"])("rejects positions from the previous %s layout", async (mode) => {
  const { store, id, snapshot } = await setup();
  if (mode === "unified") store.setUnified(id, true);
  else await store.setCollapseUnchanged(id, false);
  store.savePaneViewState(id, snapshot);
  expect(store.getPaneViewState(id, "right")).toBeUndefined();
});
