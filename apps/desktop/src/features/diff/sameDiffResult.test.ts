import { expect, it } from "vitest";
import type { DiffFileResult } from "@/lib/backend";
import { sameDiffResult } from "./sameDiffResult";

function diff(): DiffFileResult {
  return {
    path: "a.txt",
    leftLabel: "Staged",
    rightLabel: "Local",
    leftText: "old\n",
    rightText: "new\n",
    binary: false,
    tooLarge: false,
    encoding: "utf-8",
    eolMismatch: false,
    hunks: [
      {
        index: 0,
        header: "@@ -1 +1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ["-old", "+new"],
      },
    ],
  };
}

it("recognizes identical large responses without using serialized content", () => {
  const first = diff();
  first.leftText = "unchanged\n".repeat(100000);
  const second = structuredClone(first);
  expect(sameDiffResult(first, second)).toBe(true);
});

it("detects equal-length text changes even when hunk positions are identical", () => {
  const first = diff();
  const second = diff();
  second.hunks[0]!.lines[1] = "+NEW";
  expect(sameDiffResult(first, second)).toBe(false);
  second.hunks = first.hunks;
  second.rightText = "NEW\n";
  expect(sameDiffResult(first, second)).toBe(false);
});

it("detects changed line mappings and expanded context with unchanged hunk text", () => {
  const first = diff();
  const second = diff();
  second.hunks[0]!.newStart = 9;
  expect(sameDiffResult(first, second)).toBe(false);
  second.hunks = first.hunks;
  second.leftText = null;
  expect(sameDiffResult(first, second)).toBe(false);
});

it("detects changed binary, size, encoding and line-ending notices", () => {
  const first = diff();
  for (const change of [
    { binary: true },
    { tooLarge: true },
    { encoding: "other" },
    { eolMismatch: true },
  ]) {
    expect(sameDiffResult(first, { ...first, ...change })).toBe(false);
  }
});
