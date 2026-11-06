import type { DiffHunk } from "@/lib/backend";

/** Cheap stable fingerprint so CodeMirror remounts when selection/content changes. */
export function contentFingerprint(opts: {
  paintKey: string;
  side: string;
  unified: boolean;
  content: string;
  hunks: DiffHunk[];
  changedCount: number;
  lineMapLen: number;
  enableInline: boolean;
}): string {
  const { content, hunks } = opts;
  // Sample head/mid/tail so same-length different files still remount.
  const n = content.length;
  const sample = [
    content.slice(0, 48),
    n > 96 ? content.slice((n / 2) | 0, ((n / 2) | 0) + 24) : "",
    content.slice(Math.max(0, n - 48)),
  ].join("·");
  const hunkSig = hunks
    .map((h) => `${h.header}:${h.lines.length}:${h.lines[0] ?? ""}:${h.lines[h.lines.length - 1] ?? ""}`)
    .join("|");
  return [
    opts.paintKey,
    opts.side,
    opts.unified ? "u" : "s",
    String(n),
    sample,
    String(hunks.length),
    hunkSig,
    String(opts.changedCount),
    String(opts.lineMapLen),
    opts.enableInline ? "1" : "0",
  ].join("¦");
}

/** Normalize display text so CRLF/LF identical lines share the same glyphs. */
export function normalizeEolForDisplay(text: string): string {
  if (!text.includes("\r")) return text;
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
