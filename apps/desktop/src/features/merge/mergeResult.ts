import type { Merge3Block, Merge3Result } from "@/lib/backend";

const startMarker = (index: number) => `<<<<<<< Yours (${index + 1})`;
const endMarker = (index: number) => `>>>>>>> Theirs (${index + 1})`;
const terminated = (text: string) => (text && !text.endsWith("\n") ? `${text}\n` : text);

export function renderMergeResult(merge: Merge3Result): string {
  return merge.blocks
    .map((block, index) =>
      block.kind === "conflict"
        ? `${startMarker(index)}\n${terminated(block.oursLines.join(""))}=======\n${terminated(block.theirsLines.join(""))}${endMarker(index)}\n`
        : block.resultLines.join(""),
    )
    .join("");
}

export function unresolvedConflictCount(text: string): number {
  const starts = text.match(/^<{7}(?: |\r?$)/gm)?.length ?? 0;
  const ends = text.match(/^>{7}(?: |\r?$)/gm)?.length ?? 0;
  return Math.max(starts, ends);
}

/** Replace just the selected conflict, retaining hand edits everywhere else. */
export function acceptConflictBlock(
  text: string,
  block: Merge3Block,
  index: number,
  side: "ours" | "theirs",
): string | null {
  const start = text.indexOf(`${startMarker(index)}\n`);
  const end = text.indexOf(`${endMarker(index)}\n`, start);
  if (start < 0 || end < start || (start > 0 && text[start - 1] !== "\n")) return null;
  return (
    text.slice(0, start) +
    (side === "ours" ? block.oursLines : block.theirsLines).join("") +
    text.slice(end + endMarker(index).length + 1)
  );
}
