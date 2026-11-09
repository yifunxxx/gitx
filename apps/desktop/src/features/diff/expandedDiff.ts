import type { DiffHunk } from "@/lib/backend";
import { normalizeEolForDisplay } from "./diffPaint";

function lines(text: string): string[] {
  const normalized = normalizeEolForDisplay(text);
  if (!normalized) return [];
  const result = normalized.split("\n");
  if (normalized.endsWith("\n")) result.pop();
  return result;
}

/** Fill the omitted context with right-side text, retaining the original edits. */
export function expandUnifiedHunks(hunks: DiffHunk[], left: string, right: string): DiffHunk[] {
  const before = lines(left);
  const after = lines(right);
  const body: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const start = Math.max(0, hunk.newStart - 1);
    for (; cursor < start; cursor++) body.push(` ${after[cursor] ?? ""}`);
    for (const line of hunk.lines) body.push(line);
    cursor = start + hunk.newLines;
  }
  for (; cursor < after.length; cursor++) body.push(` ${after[cursor]}`);
  if (!body.length) return [];
  return [{
    index: 0,
    header: `@@ -${before.length ? 1 : 0},${before.length} +${after.length ? 1 : 0},${after.length} @@`,
    oldStart: before.length ? 1 : 0, oldLines: before.length,
    newStart: after.length ? 1 : 0, newLines: after.length,
    lines: body,
  }];
}
