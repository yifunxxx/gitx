import type { DiffFileResult } from "@/lib/backend";

/** Compare the visible result without retaining a serialized copy of file text. */
export function sameDiffResult(a: DiffFileResult, b: DiffFileResult): boolean {
  if (a === b) return true;
  if (
    a.path !== b.path ||
    a.leftLabel !== b.leftLabel ||
    a.rightLabel !== b.rightLabel ||
    a.leftText !== b.leftText ||
    a.rightText !== b.rightText ||
    a.binary !== b.binary ||
    a.tooLarge !== b.tooLarge ||
    a.encoding !== b.encoding ||
    a.eolMismatch !== b.eolMismatch ||
    a.hunks.length !== b.hunks.length
  )
    return false;
  return a.hunks.every((hunk, index) => {
    const other = b.hunks[index]!;
    return (
      hunk.index === other.index &&
      hunk.header === other.header &&
      hunk.oldStart === other.oldStart &&
      hunk.oldLines === other.oldLines &&
      hunk.newStart === other.newStart &&
      hunk.newLines === other.newLines &&
      hunk.lines.length === other.lines.length &&
      hunk.lines.every((line, i) => line === other.lines[i])
    );
  });
}
