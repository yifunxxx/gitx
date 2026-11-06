import { describe, expect, it } from "vitest";
import type { ChangelistsState, FileChange } from "@/lib/backend";

function isIgnored(f: FileChange): boolean {
  return f.kind === "ignored" || f.indexStatus === "!";
}
function isStaged(f: FileChange): boolean {
  if (isIgnored(f)) return false;
  return f.indexStatus !== "." && f.indexStatus !== "?" && f.indexStatus !== "!";
}
function isUntracked(f: FileChange): boolean {
  if (isIgnored(f)) return false;
  return f.kind === "untracked" || f.indexStatus === "?";
}
function isUnstaged(f: FileChange): boolean {
  if (isUntracked(f) || isIgnored(f)) return false;
  return f.worktreeStatus !== "." && f.worktreeStatus !== "?" && f.worktreeStatus !== "!";
}
function isChanged(f: FileChange): boolean {
  return isStaged(f) || isUnstaged(f);
}

function filesForChangelist(
  files: FileChange[],
  state: ChangelistsState,
  listId: string,
): FileChange[] {
  const active = state.lists.find((l) => l.active)?.id ?? state.lists[0]?.id ?? "default";
  return files.filter(isChanged).filter((f) => {
    const assigned = state.assignments.find((a) => a.path === f.path)?.listId;
    return (assigned ?? active) === listId;
  });
}

describe("staging sections", () => {
  it("splits staged / unstaged / unversioned / ignored", () => {
    const files: FileChange[] = [
      {
        path: "a.ts",
        origPath: null,
        indexStatus: "M",
        worktreeStatus: ".",
        kind: "modified",
      },
      {
        path: "b.ts",
        origPath: null,
        indexStatus: ".",
        worktreeStatus: "M",
        kind: "modified",
      },
      {
        path: "c.ts",
        origPath: null,
        indexStatus: "?",
        worktreeStatus: "?",
        kind: "untracked",
      },
      {
        path: "d.tmp",
        origPath: null,
        indexStatus: "!",
        worktreeStatus: "!",
        kind: "ignored",
      },
    ];
    expect(files.filter(isStaged).map((f) => f.path)).toEqual(["a.ts"]);
    expect(files.filter(isUnstaged).map((f) => f.path)).toEqual(["b.ts"]);
    expect(files.filter(isUntracked).map((f) => f.path)).toEqual(["c.ts"]);
    expect(files.filter(isIgnored).map((f) => f.path)).toEqual(["d.tmp"]);
  });

  it("assigns unassigned changes to the active changelist", () => {
    const files: FileChange[] = [
      {
        path: "a.ts",
        origPath: null,
        indexStatus: ".",
        worktreeStatus: "M",
        kind: "modified",
      },
      {
        path: "b.ts",
        origPath: null,
        indexStatus: "M",
        worktreeStatus: ".",
        kind: "modified",
      },
    ];
    const state: ChangelistsState = {
      lists: [
        { id: "default", name: "Changes", comment: "", active: true },
        { id: "feature", name: "Feature", comment: "", active: false },
      ],
      assignments: [{ path: "b.ts", listId: "feature", hunkRanges: [] }],
    };
    expect(filesForChangelist(files, state, "default").map((f) => f.path)).toEqual(["a.ts"]);
    expect(filesForChangelist(files, state, "feature").map((f) => f.path)).toEqual(["b.ts"]);
  });
});
