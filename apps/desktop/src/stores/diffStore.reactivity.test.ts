import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, watch } from "vue";
import { useDiffStore } from "./diffStore";

vi.mock("@/lib/backend", () => ({
  getBackend: () => ({
    diffFile: vi.fn(async ({ filePath }: { filePath: string }) => ({
      path: filePath,
      leftLabel: "Staged",
      rightLabel: "Local",
      leftText: null,
      rightText: null,
      binary: false,
      tooLarge: false,
      hunks: [
        {
          index: 0,
          header: "@@ -1,1 +1,2 @@",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 2,
          lines: [" a", "+b"],
        },
      ],
      encoding: "utf-8",
      eolMismatch: false,
    })),
    diffFileAt: vi.fn(),
  }),
}));

vi.mock("./workspaceStore", () => ({
  useWorkspaceStore: () => ({
    repoPath: "/tmp/demo",
    repoId: "demo",
  }),
}));

vi.mock("./layoutStore", () => ({
  useLayoutStore: () => ({
    activeEditorKind: "welcome",
  }),
}));

describe("diffStore reactivity (GIT-34)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("notifies watchers when IPC result lands without a tab flip", async () => {
    const diffs = useDiffStore();
    const seen: Array<string | null | undefined> = [];
    watch(
      () => diffs.tabs.find((t) => t.id === diffs.activeId)?.result?.path,
      (p) => {
        seen.push(p);
      },
      { immediate: true },
    );

    await diffs.openFileDiff("A.java", "index", "worktree");
    await nextTick();

    expect(diffs.activeId).toBe("index:worktree:A.java");
    expect(diffs.tabs[0]?.result?.path).toBe("A.java");
    // Watcher must fire from patchTab — not only after an unrelated remount.
    expect(seen).toContain("A.java");
    expect(diffs.paintEpoch).toBeGreaterThan(0);
  });

  it("bumps paintEpoch when switching between cached file tabs", async () => {
    const diffs = useDiffStore();
    await diffs.openFileDiff("A.java", "index", "worktree");
    await diffs.openFileDiff("B.java", "index", "worktree");
    const epochAfterB = diffs.paintEpoch;
    await diffs.openFileDiff("A.java", "index", "worktree"); // cached
    expect(diffs.activeId).toBe("index:worktree:A.java");
    expect(diffs.paintEpoch).toBeGreaterThan(epochAfterB);
  });
});
