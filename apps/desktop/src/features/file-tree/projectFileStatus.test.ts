import { expect, it } from "vitest";
import type { FileChange } from "@/lib/backend";
import { projectFileDiffSection, projectFileStatusLabel } from "./projectFileStatus";

it.each([
  ["modified", "M", "M", "unstaged", "M"],
  ["renamed", "R", ".", "staged", "R"],
  ["modified", "A", "M", "unstaged", "AM"],
  ["deleted", ".", "D", "unstaged", "D"],
  ["unmerged", "U", "U", "unstaged", "U"],
  ["untracked", "?", "?", "unversioned", "?"],
  ["ignored", "!", "!", null, "!"],
] as const)(
  "maps %s %s%s to its actual Diff layer and status",
  (kind, indexStatus, worktreeStatus, section, label) => {
    const change: FileChange = {
      path: "file.txt",
      origPath: null,
      kind,
      indexStatus,
      worktreeStatus,
    };
    expect(projectFileDiffSection(change)).toBe(section);
    expect(projectFileStatusLabel(change)).toBe(label);
  },
);

it("disables Diff without a known change", () => {
  expect(projectFileDiffSection(undefined)).toBeNull();
});
