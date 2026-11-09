import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reactive } from "vue";
import { useWorktreesStore } from "./worktreesStore";
import { useStashShelfStore } from "./stashShelfStore";
import { useConflictsStore } from "./conflictsStore";
import { useRewriteStore } from "./rewriteStore";

const mocks = vi.hoisted(() => ({
  ws: {} as { repoPath: string; isRepo: boolean; navigationToken: () => number },
  backend: {
    worktreeList: vi.fn(),
    stashList: vi.fn(),
    shelfList: vi.fn(),
    shelfListDeleted: vi.fn(),
    conflictsList: vi.fn(),
    repoOpStateGet: vi.fn(),
  },
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks.backend }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("./settingsStore", () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock("./layoutStore", () => ({ useLayoutStore: () => ({ activeEditorKind: "welcome" }) }));
vi.mock("@/features/merge/DirtyWorktreeDialog.vue", () => ({ default: {} }));
vi.mock("@/features/merge/ConflictsDialog.vue", () => ({ default: {} }));
vi.mock("@/composables/useToast", () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  mocks.ws = reactive({ repoPath: "A", isRepo: true, navigationToken: () => 0 });
  mocks.backend.shelfList.mockResolvedValue([]);
  mocks.backend.shelfListDeleted.mockResolvedValue([]);
});
const targets = [
  {
    name: "worktrees",
    method: "worktreeList" as const,
    old: [{ path: "old" }],
    fresh: [{ path: "fresh" }],
    make: () => {
      const s = useWorktreesStore();
      return { refresh: s.refresh, value: () => s.items };
    },
  },
  {
    name: "stash",
    method: "stashList" as const,
    old: [{ sha: "old" }],
    fresh: [{ sha: "fresh" }],
    make: () => {
      const s = useStashShelfStore();
      return { refresh: s.refresh, value: () => s.stashes };
    },
  },
  {
    name: "conflicts",
    method: "conflictsList" as const,
    old: { entries: [], marker: "old" },
    fresh: { entries: [], marker: "fresh" },
    make: () => {
      const s = useConflictsStore();
      return { refresh: s.refresh, value: () => s.list };
    },
  },
  {
    name: "operation state",
    method: "repoOpStateGet" as const,
    old: { kind: "merging" },
    fresh: { kind: "normal" },
    make: () => {
      const s = useRewriteStore();
      return { refresh: s.refreshOpState, value: () => s.opState };
    },
  },
];

it.each(targets)("$name rejects results after repository A → B → A", async (target) => {
  const store = target.make();
  let resolve!: (value: unknown) => void;
  mocks.backend[target.method].mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const old = store.refresh();
  mocks.ws.repoPath = "B";
  mocks.ws.repoPath = "A";
  mocks.backend[target.method].mockResolvedValueOnce(target.fresh);
  await store.refresh();
  resolve(target.old);
  await old;
  expect(store.value()).toEqual(target.fresh);
});

it.each(targets)(
  "$name rejects an older overlapping refresh in the same repository",
  async (target) => {
    const store = target.make();
    let resolve!: (value: unknown) => void;
    mocks.backend[target.method].mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const old = store.refresh();
    mocks.backend[target.method].mockResolvedValueOnce(target.fresh);
    await store.refresh();
    resolve(target.old);
    await old;
    expect(store.value()).toEqual(target.fresh);
  },
);
