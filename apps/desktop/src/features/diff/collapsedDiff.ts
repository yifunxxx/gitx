import type { DiffHunk } from "@/lib/backend";

export type CollapsedSide = {
  text: string;
  /** 1-based doc line → original file line number (0 = gap/header). */
  lineMap: number[];
  /** Doc lines (1-based) that are changed. */
  changed: Set<number>;
};

/**
 * Build collapsed left/right documents from hunks only — avoids feeding
 * multi-thousand-line full files into CodeMirror when "Collapse unchanged".
 */
export function buildCollapsedSides(hunks: DiffHunk[]): {
  left: CollapsedSide;
  right: CollapsedSide;
} {
  const leftLines: string[] = [];
  const rightLines: string[] = [];
  const leftMap: number[] = [];
  const rightMap: number[] = [];
  const leftChanged = new Set<number>();
  const rightChanged = new Set<number>();

  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi]!;
    if (hi > 0) {
      leftLines.push("⋯");
      rightLines.push("⋯");
      leftMap.push(0);
      rightMap.push(0);
    }

    let oldLine = h.oldStart;
    let newLine = h.newStart;
    // Pair delete/insert runs for roughly aligned side-by-side rows.
    const rows: { left?: string; right?: string; oldN?: number; newN?: number; lCh?: boolean; rCh?: boolean }[] =
      [];
    let i = 0;
    const lines = h.lines;
    while (i < lines.length) {
      const line = lines[i]!;
      if (line.startsWith("\\")) {
        i += 1;
        continue;
      }
      if (line.startsWith(" ")) {
        rows.push({
          left: line.slice(1),
          right: line.slice(1),
          oldN: oldLine,
          newN: newLine,
        });
        oldLine += 1;
        newLine += 1;
        i += 1;
        continue;
      }
      if (line.startsWith("-")) {
        const dels: { text: string; n: number }[] = [];
        while (i < lines.length && lines[i]!.startsWith("-")) {
          dels.push({ text: lines[i]!.slice(1), n: oldLine });
          oldLine += 1;
          i += 1;
        }
        const adds: { text: string; n: number }[] = [];
        while (i < lines.length && lines[i]!.startsWith("+")) {
          adds.push({ text: lines[i]!.slice(1), n: newLine });
          newLine += 1;
          i += 1;
        }
        const n = Math.max(dels.length, adds.length);
        for (let k = 0; k < n; k++) {
          rows.push({
            left: dels[k]?.text,
            right: adds[k]?.text,
            oldN: dels[k]?.n,
            newN: adds[k]?.n,
            lCh: dels[k] != null,
            rCh: adds[k] != null,
          });
        }
        continue;
      }
      if (line.startsWith("+")) {
        rows.push({
          right: line.slice(1),
          newN: newLine,
          rCh: true,
        });
        newLine += 1;
        i += 1;
        continue;
      }
      i += 1;
    }

    for (const r of rows) {
      leftLines.push(r.left ?? "");
      rightLines.push(r.right ?? "");
      leftMap.push(r.oldN ?? 0);
      rightMap.push(r.newN ?? 0);
      if (r.lCh) leftChanged.add(leftLines.length);
      if (r.rCh) rightChanged.add(rightLines.length);
    }
  }

  return {
    left: { text: leftLines.join("\n"), lineMap: leftMap, changed: leftChanged },
    right: { text: rightLines.join("\n"), lineMap: rightMap, changed: rightChanged },
  };
}

export function countHunkLines(hunks: DiffHunk[]): number {
  let n = 0;
  for (const h of hunks) n += h.lines.length;
  return n;
}
