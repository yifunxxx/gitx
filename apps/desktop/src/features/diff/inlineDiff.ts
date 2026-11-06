import type { DiffHunk } from "@/lib/backend";

/** Inclusive-exclusive character range within a single line (0-based). */
export type CharRange = { from: number; to: number };

export type SideInlineRanges = Map<number, CharRange[]>;

/**
 * Pair deleted/inserted lines within each hunk and mark intra-line differences.
 * Line numbers are 1-based document lines on each side.
 */
export function computeSideInlineRanges(hunks: DiffHunk[]): {
  left: SideInlineRanges;
  right: SideInlineRanges;
} {
  const left: SideInlineRanges = new Map();
  const right: SideInlineRanges = new Map();

  for (const h of hunks) {
    const dels: { lineNo: number; text: string }[] = [];
    const adds: { lineNo: number; text: string }[] = [];
    let oldNo = h.oldStart;
    let newNo = h.newStart;
    for (const raw of h.lines) {
      if (raw.startsWith("\\")) continue;
      if (raw.startsWith("-")) {
        dels.push({ lineNo: oldNo, text: raw.slice(1) });
        oldNo += 1;
      } else if (raw.startsWith("+")) {
        adds.push({ lineNo: newNo, text: raw.slice(1) });
        newNo += 1;
      } else if (raw.startsWith(" ") || raw === "") {
        oldNo += 1;
        newNo += 1;
      }
    }

    const n = Math.min(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const d = dels[i]!;
      const a = adds[i]!;
      const { left: lr, right: rr } = charRanges(d.text, a.text);
      if (lr.length) left.set(d.lineNo, lr);
      if (rr.length) right.set(a.lineNo, rr);
    }
    // Unpaired pure deletes/inserts: highlight whole line content (skip empty).
    for (let i = n; i < dels.length; i++) {
      const d = dels[i]!;
      if (d.text.length) left.set(d.lineNo, [{ from: 0, to: d.text.length }]);
    }
    for (let i = n; i < adds.length; i++) {
      const a = adds[i]!;
      if (a.text.length) right.set(a.lineNo, [{ from: 0, to: a.text.length }]);
    }
  }

  return { left, right };
}

/** Unified-view ranges keyed by 1-based line index in the concatenated hunk text. */
export function computeUnifiedInlineRanges(hunks: DiffHunk[]): SideInlineRanges {
  const out: SideInlineRanges = new Map();
  let lineIdx = 0;
  for (const h of hunks) {
    lineIdx += 1; // header
    const dels: { idx: number; text: string }[] = [];
    const adds: { idx: number; text: string }[] = [];
    for (const raw of h.lines) {
      lineIdx += 1;
      if (raw.startsWith("-")) dels.push({ idx: lineIdx, text: raw.slice(1) });
      else if (raw.startsWith("+")) adds.push({ idx: lineIdx, text: raw.slice(1) });
    }
    const n = Math.min(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const d = dels[i]!;
      const a = adds[i]!;
      const { left: lr, right: rr } = charRanges(d.text, a.text);
      // Unified lines keep the +/- prefix at column 0; shift ranges by 1.
      if (lr.length) out.set(d.idx, lr.map((r) => ({ from: r.from + 1, to: r.to + 1 })));
      if (rr.length) out.set(a.idx, rr.map((r) => ({ from: r.from + 1, to: r.to + 1 })));
    }
    for (let i = n; i < dels.length; i++) {
      const d = dels[i]!;
      if (d.text.length) out.set(d.idx, [{ from: 1, to: d.text.length + 1 }]);
    }
    for (let i = n; i < adds.length; i++) {
      const a = adds[i]!;
      if (a.text.length) out.set(a.idx, [{ from: 1, to: a.text.length + 1 }]);
    }
  }
  return out;
}

export function charRanges(
  oldText: string,
  newText: string,
): { left: CharRange[]; right: CharRange[] } {
  if (oldText === newText) return { left: [], right: [] };

  let prefix = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (prefix < minLen && oldText[prefix] === newText[prefix]) prefix += 1;

  let oldSuffix = oldText.length;
  let newSuffix = newText.length;
  while (
    oldSuffix > prefix &&
    newSuffix > prefix &&
    oldText[oldSuffix - 1] === newText[newSuffix - 1]
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }

  const leftMid = oldText.slice(prefix, oldSuffix);
  const rightMid = newText.slice(prefix, newSuffix);

  // Prefer token-level marks when the middle is long enough.
  if (leftMid.length + rightMid.length > 24) {
    const token = tokenRanges(leftMid, rightMid);
    return {
      left: token.left.map((r) => ({ from: r.from + prefix, to: r.to + prefix })),
      right: token.right.map((r) => ({ from: r.from + prefix, to: r.to + prefix })),
    };
  }

  return {
    left: prefix < oldSuffix ? [{ from: prefix, to: oldSuffix }] : [],
    right: prefix < newSuffix ? [{ from: prefix, to: newSuffix }] : [],
  };
}

function tokenize(s: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const re = /(\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    out.push({ text: m[0]!, start: m.index });
  }
  return out;
}

function tokenRanges(
  oldText: string,
  newText: string,
): { left: CharRange[]; right: CharRange[] } {
  const ot = tokenize(oldText);
  const nt = tokenize(newText);
  const n = ot.length;
  const m = nt.length;
  // LCS lengths
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        ot[i]!.text === nt[j]!.text
          ? (dp[i + 1]![j + 1]! + 1) as number
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const keepOld = new Array<boolean>(n).fill(false);
  const keepNew = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ot[i]!.text === nt[j]!.text) {
      keepOld[i] = true;
      keepNew[j] = true;
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return {
    left: mergeTokenMarks(ot, keepOld),
    right: mergeTokenMarks(nt, keepNew),
  };
}

function mergeTokenMarks(
  tokens: { text: string; start: number }[],
  keep: boolean[],
): CharRange[] {
  const ranges: CharRange[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (keep[i]) continue;
    const t = tokens[i]!;
    const from = t.start;
    const to = t.start + t.text.length;
    const last = ranges[ranges.length - 1];
    if (last && last.to === from) last.to = to;
    else ranges.push({ from, to });
  }
  return ranges;
}
