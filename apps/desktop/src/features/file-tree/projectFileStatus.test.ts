import { expect, it } from "vitest";
import type { FileChange } from "@/lib/backend";
import {
  projectFileDiffSection,
  projectFileStatusLabel,
  aggregateFolderChanges,
} from "./projectFileStatus";

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
it("aggregates deleted and renamed descendants without duplicate parents or other roots", () => {
  const file = (
    path: string,
    kind: FileChange["kind"],
    origPath: string | null = null,
  ): FileChange => ({ path, kind, origPath, indexStatus: ".", worktreeStatus: "M" });
  const counts = aggregateFolderChanges(
    [
      file("src/deep/deleted", "deleted"),
      file("src/new", "renamed", "src/old"),
      file("ignored/a", "ignored"),
      file("outside/a", "modified"),
    ],
    "C:/p",
    "C:/p",
  );
  expect(counts.get("src")).toBe(2);
  expect(counts.get("src/deep")).toBe(1);
  expect(counts.has("ignored")).toBe(false);
  expect(aggregateFolderChanges([file("src/a", "modified")], "C:/other", "C:/p").size).toBe(0);
});
