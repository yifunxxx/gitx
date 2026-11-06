import { describe, expect, it } from "vitest";
import { charRanges, computeSideInlineRanges } from "./inlineDiff";
import type { DiffHunk } from "@/lib/backend";

describe("charRanges", () => {
  it("marks the differing middle", () => {
    const r = charRanges("hello world", "hello there");
    expect(r.left.length).toBeGreaterThan(0);
    expect(r.right.length).toBeGreaterThan(0);
    expect(r.left[0]!.from).toBeGreaterThan(0);
  });

  it("returns empty for identical strings", () => {
    expect(charRanges("abc", "abc")).toEqual({ left: [], right: [] });
  });

  it("caps token LCS on long tokenized middles", () => {
    // Many distinct tokens → matrix would exceed MAX_TOKEN_LCS_CELLS without the cap.
    const oldText = Array.from({ length: 400 }, (_, i) => `tok${i}`).join(" ");
    const newText = Array.from({ length: 400 }, (_, i) => `tok${i + 1}`).join(" ");
    const r = charRanges(oldText, newText);
    expect(r.left.length).toBeGreaterThan(0);
    expect(r.right.length).toBeGreaterThan(0);
  });
});

describe("computeSideInlineRanges", () => {
  it("pairs delete/insert lines inside a hunk", () => {
    const hunks: DiffHunk[] = [
      {
        index: 0,
        header: "@@ -1,1 +1,1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ["-foo bar", "+foo baz"],
      },
    ];
    const { left, right } = computeSideInlineRanges(hunks);
    expect(left.get(1)?.length).toBeGreaterThan(0);
    expect(right.get(1)?.length).toBeGreaterThan(0);
  });
});
