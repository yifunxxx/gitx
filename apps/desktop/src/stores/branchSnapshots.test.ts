import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { computed, reactive } from "vue";
import { useBranchesStore } from "./branchesStore";
import { branchListRows } from "@/features/branches/branchListRows";
import type { RefEntry, RefsList, RemoteInfo } from "@/lib/backend";

const mocks = vi.hoisted(() => ({ ws: {} as any, refsList: vi.fn(), remoteList: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => mocks }));
vi.mock("./workspaceStore", () => ({ useWorkspaceStore: () => mocks.ws }));
vi.mock("./settingsStore", () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock("./changesStore", () => ({ useChangesStore: () => ({}) }));
vi.mock("./logStore", () => ({ useLogStore: () => ({}) }));
vi.mock("@/i18n", () => ({ i18n: { global: { t: (key: string) => key } } }));
let pinia: ReturnType<typeof createPinia>;
let data: RefsList;
let remotes: RemoteInfo[];
const entry: RefEntry = {
  name: "feature/topic",
  fullName: "refs/heads/feature/topic",
  kind: "localBranch",
  sha: "a",
  upstream: null,
  ahead: null,
  behind: null,
  isHead: false,
  subject: "topic",
  committerTime: 1,
  peeledSha: null,
  isFavorite: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  pinia = createPinia();
  setActivePinia(pinia);
  mocks.ws = reactive({
    repoPath: "A",
    repoId: "A",
    gitDir: "A/.git",
    isRepo: true,
    generation: 0,
    navigationToken() {
      return this.generation;
    },
  });
  data = {
    local: [{ ...entry }, { ...entry, name: "main", fullName: "refs/heads/main", isHead: true }],
    remote: [
      {
        ...entry,
        kind: "remoteBranch",
        name: "origin/topic",
        fullName: "refs/remotes/origin/topic",
      },
    ],
    tags: [{ ...entry, kind: "tag", name: "v1", fullName: "refs/tags/v1" }],
    recent: ["main"],
    current: "main",
    detached: false,
  };
  remotes = [{ name: "origin", fetchUrl: "https://example.invalid/repo", pushUrl: null }];
  mocks.refsList.mockImplementation(async () => structuredClone(data));
  mocks.remoteList.mockImplementation(async () => structuredClone(remotes));
});
afterEach(() => disposePinia(pinia));

it.each(["", "topic"])(
  "does not rebuild branch rows for equal refreshed data (search=%s)",
  async (search) => {
    const store = useBranchesStore();
    store.search = search;
    await store.refresh();
    const build = vi.fn(() =>
      branchListRows(
        store.filteredLocal,
        store.filteredRemote,
        store.filteredTags,
        true,
        true,
        store.refs!.recent,
      ),
    );
    const rows = computed(build),
      initial = rows.value;
    const initialRefs = store.refs,
      initialRemotes = store.remotes;
    for (let i = 0; i < 3; i++) {
      await store.refresh();
      expect(rows.value).toBe(initial);
      expect(store.refs).toBe(initialRefs);
      expect(store.remotes).toBe(initialRemotes);
    }
    expect(build).toHaveBeenCalledOnce();
    expect(mocks.refsList).toHaveBeenCalledTimes(4);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  },
);

const changes = {
  name: "renamed",
  fullName: "refs/heads/renamed",
  kind: "tag",
  sha: "b",
  upstream: "origin/topic",
  ahead: 0,
  behind: 2,
  isHead: true,
  subject: "changed",
  committerTime: 2,
  peeledSha: "c",
  isFavorite: true,
} satisfies RefEntry;
it.each(
  (["local", "remote", "tags"] as const).flatMap((section) =>
    Object.entries(changes).map(([field, value]) => ({ section, field, value })),
  ),
)("publishes a change to $section.$field", async ({ section, field, value }) => {
  const store = useBranchesStore();
  await store.refresh();
  // A distinct value is required for each section's original enum/boolean.
  const update =
    field === "kind" ? (data[section][0]!.kind === "tag" ? "localBranch" : "tag") : value;
  const next = { ...data[section][0]!, [field]: update };
  data[section][0] = next;
  const previous = store.refs;
  await store.refresh();
  expect(store.refs).not.toBe(previous);
  expect(store.refs![section][0]).toEqual(next);
});

it.each(["order", "add", "remove", "recent", "current", "detached"])(
  "publishes changed %s metadata",
  async (kind) => {
    const store = useBranchesStore();
    await store.refresh();
    const previous = store.refs;
    if (kind === "order") data.local.reverse();
    if (kind === "add") data.tags.push({ ...entry, name: "v2" });
    if (kind === "remove") data.remote = [];
    if (kind === "recent") data.recent = ["feature/topic", "main"];
    if (kind === "current") data.current = null;
    if (kind === "detached") data.detached = true;
    await store.refresh();
    expect(store.refs).not.toBe(previous);
    expect(store.refs).toEqual(data);
  },
);

it.each(["name", "fetchUrl", "pushUrl"] as const)(
  "publishes remote %s changes independently",
  async (field) => {
    const store = useBranchesStore();
    await store.refresh();
    const refs = store.refs;
    remotes[0]![field] = "changed";
    await store.refresh();
    expect(store.remotes).toEqual(remotes);
    expect(store.refs).toBe(refs);
  },
);

it("keeps the last good snapshot after failure and clears the error on an equal retry", async () => {
  const store = useBranchesStore();
  await store.refresh();
  const refs = store.refs;
  mocks.refsList.mockRejectedValueOnce(new Error("read failed"));
  await store.refresh();
  expect(store.refs).toBe(refs);
  expect(store.error).toContain("read failed");
  expect(store.loading).toBe(false);
  await store.refresh();
  expect(store.refs).toBe(refs);
  expect(store.error).toBeNull();
});

it("does not publish an older request over a newer snapshot", async () => {
  const store = useBranchesStore();
  await store.refresh();
  let resolve!: (value: RefsList) => void;
  mocks.refsList.mockImplementationOnce(
    () =>
      new Promise<RefsList>((done) => {
        resolve = done;
      }),
  );
  const old = store.refresh();
  data.local[0]!.sha = "new";
  await store.refresh();
  const current = store.refs;
  resolve({ ...structuredClone(data), current: "stale" });
  await old;
  expect(store.refs).toBe(current);
  expect(store.refs!.current).toBe("main");
});

it("does not carry an equal snapshot across repositories", async () => {
  const store = useBranchesStore();
  await store.refresh();
  const previous = store.refs;
  mocks.ws.repoPath = "B";
  mocks.ws.repoId = "B";
  mocks.ws.generation++;
  await store.refresh();
  expect(store.refs).not.toBe(previous);
  expect(store.refs).toEqual(data);
});
