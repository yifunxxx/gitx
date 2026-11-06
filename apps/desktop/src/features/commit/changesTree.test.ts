import { describe, expect, it } from "vitest";
import type { FileChange } from "@/lib/backend";

function isStaged(f: FileChange): boolean {
  return f.indexStatus !== "." && f.indexStatus !== "?" && f.indexStatus !== "!";
}
function isUntracked(f: FileChange): boolean {
  return f.kind === "untracked" || f.indexStatus === "?";
}
function isUnstaged(f: FileChange): boolean {
  if (isUntracked(f)) return false;
  return f.worktreeStatus !== "." && f.worktreeStatus !== "?" && f.worktreeStatus !== "!";
}

describe("staging sections", () => {
  it("splits staged / unstaged / unversioned", () => {
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
    ];
    expect(files.filter(isStaged).map((f) => f.path)).toEqual(["a.ts"]);
    expect(files.filter(isUnstaged).map((f) => f.path)).toEqual(["b.ts"]);
    expect(files.filter(isUntracked).map((f) => f.path)).toEqual(["c.ts"]);
  });
});
