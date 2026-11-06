import { describe, expect, it } from "vitest";
import type { DiffHunk } from "@/lib/backend";
import { contentFingerprint, normalizeEolForDisplay } from "./diffPaint";
import { buildCollapsedSides } from "./collapsedDiff";

describe("diffPaint / GIT-33", () => {
  it("normalizes CRLF to LF for display", () => {
    expect(normalizeEolForDisplay("a\r\nb\r\n")).toBe("a\nb\n");
    expect(normalizeEolForDisplay("a\nb\n")).toBe("a\nb\n");
  });

  it("fingerprint changes when selection paintKey or content changes", () => {
    const hunks: DiffHunk[] = [
      {
        index: 0,
        header: "@@ -1,2 +1,3 @@",
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 3,
        lines: [" a", "-b", "+B", "+c"],
      },
    ];
    const a = contentFingerprint({
      paintKey: "index:worktree:A.java",
      side: "left",
      unified: false,
      content: "hello\nworld",
      hunks,
      changedCount: 1,
      lineMapLen: 2,
      enableInline: true,
    });
    const b = contentFingerprint({
      paintKey: "index:worktree:B.java",
      side: "left",
      unified: false,
      content: "hello\nworld",
      hunks,
      changedCount: 1,
      lineMapLen: 2,
      enableInline: true,
    });
    const c = contentFingerprint({
      paintKey: "index:worktree:A.java",
      side: "left",
      unified: false,
      content: "hello\nWORLD",
      hunks,
      changedCount: 1,
      lineMapLen: 2,
      enableInline: true,
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("collapsed equal context lines are not marked changed", () => {
    const hunks: DiffHunk[] = [
      {
        index: 0,
        header: "@@ -1,5 +1,6 @@",
        oldStart: 1,
        oldLines: 5,
        newStart: 1,
        newLines: 6,
        lines: [
          " package com.aurora.controller;",
          " import a.A;",
          "+import c.AnnotationApi;",
          " class C {",
          "-  @Autowired",
          "+  new AnnotationApi();",
          " }",
        ],
      },
    ];
    const sides = buildCollapsedSides(hunks);
    // package / import a.A / class / } are context — not in changed sets
    const leftLines = sides.left.text.split("\n");
    const pkgIdx = leftLines.indexOf("package com.aurora.controller;") + 1;
    const importIdx = leftLines.indexOf("import a.A;") + 1;
    expect(pkgIdx).toBeGreaterThan(0);
    expect(sides.left.changed.has(pkgIdx)).toBe(false);
    expect(sides.left.changed.has(importIdx)).toBe(false);
    expect(sides.right.changed.has(pkgIdx)).toBe(false);
    // Real delete/insert are marked
    expect([...sides.left.changed].length).toBeGreaterThan(0);
    expect([...sides.right.changed].length).toBeGreaterThan(0);
  });
});
