import { expect, it } from "vitest";
import { expandUnifiedHunks } from "./expandedDiff";
import type { DiffHunk } from "@/lib/backend";

it("fills gaps across multiple hunks without duplicating context", () => {
  const hunks: DiffHunk[] = [
    { index: 0, header: "", oldStart: 2, oldLines: 1, newStart: 2, newLines: 2, lines: [" b", "+add"] },
    { index: 1, header: "", oldStart: 5, oldLines: 2, newStart: 6, newLines: 1, lines: ["-e", " f"] },
  ];
  const body = expandUnifiedHunks(hunks, "a\nb\nc\nd\ne\nf\ng\n", "a\nb\nadd\nc\nd\nf\ng\n")[0]!.lines;
  expect(body.filter((l) => !l.startsWith("+")).map((l) => l.slice(1)).join("\n")).toBe("a\nb\nc\nd\ne\nf\ng");
  expect(body.filter((l) => !l.startsWith("-")).map((l) => l.slice(1)).join("\n")).toBe("a\nb\nadd\nc\nd\nf\ng");
});

it.each(["add", "delete"])("preserves a whole-file %s with an empty opposite side", (mode) => {
  const adding = mode === "add";
  const hunks = [{ index: 0, header: "", oldStart: adding ? 0 : 1, oldLines: adding ? 0 : 1, newStart: adding ? 1 : 0, newLines: adding ? 1 : 0, lines: [adding ? "+text" : "-text"] }];
  expect(expandUnifiedHunks(hunks, adding ? "" : "text", adding ? "text" : "")[0]!.lines).toEqual(hunks[0]!.lines);
});

it("keeps empty files empty and trailing blank content lines visible", () => {
  expect(expandUnifiedHunks([], "", "")).toEqual([]);
  expect(expandUnifiedHunks([], "a\r\n\r\n", "a\n\n")[0]!.lines).toEqual([" a", " "]);
});

it("handles a large expanded hunk without a spread-argument overflow", () => {
  const body = Array.from({ length: 150_000 }, () => "+x");
  const hunks = [{ index: 0, header: "", oldStart: 0, oldLines: 0, newStart: 1, newLines: body.length, lines: body }];
  expect(expandUnifiedHunks(hunks, "", "x\n".repeat(body.length))[0]!.lines).toEqual(body);
});
