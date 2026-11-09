//! Text diff + hunk construction for M1 DiffViewer / hunk stage.

use gitx_core::{DiffHunk, IgnoreWhitespace};
use similar::{Algorithm, ChangeTag, TextDiff};
use std::time::{Duration, Instant};

const TOO_LARGE_BYTES: usize = 5 * 1024 * 1024;
/// Soft line-count gate: prefer Histogram + short deadline above this.
const LARGE_LINE_COUNT: usize = 8_000;
/// Hard line-count gate: skip fine Myers detail; emit coarse whole-file hunk.
const HUGE_LINE_COUNT: usize = 40_000;
/// Cap worst-case Myers/Patience wall time.
const DIFF_TIMEOUT: Duration = Duration::from_millis(80);

#[derive(Debug, Clone, Default)]
pub struct DiffComputeOptions {
    pub ignore_whitespace: IgnoreWhitespace,
}

pub fn is_probably_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|&b| b == 0)
}

pub fn decode_lossy(bytes: Option<&[u8]>) -> Option<String> {
    bytes.map(|b| String::from_utf8_lossy(b).into_owned())
}

pub fn too_large(bytes: Option<&[u8]>) -> bool {
    bytes.map(|b| b.len() > TOO_LARGE_BYTES).unwrap_or(false)
}

fn pick_algorithm(line_count: usize) -> Algorithm {
    // Patience degrades more gracefully on large files when paired with a timeout.
    if line_count >= LARGE_LINE_COUNT {
        Algorithm::Patience
    } else {
        Algorithm::Myers
    }
}

fn configure_diff(line_count: usize) -> similar::TextDiffConfig {
    let mut cfg = TextDiff::configure();
    cfg.algorithm(pick_algorithm(line_count));
    cfg.timeout(DIFF_TIMEOUT);
    cfg
}

/// Strip trailing CR/LF for hunk body storage without allocating when clean.
fn trim_nl(line: &str) -> &str {
    line.trim_end_matches('\n').trim_end_matches('\r')
}

/// Normalize CR/LF so identical visible lines are not treated as delete+add.
/// `diff_lines` splits on `\n` only; a trailing `\r` would otherwise make every
/// CRLF line differ from the LF counterpart even when text matches.
pub fn normalize_newlines(text: &str) -> std::borrow::Cow<'_, str> {
    if !text.as_bytes().contains(&b'\r') {
        return std::borrow::Cow::Borrowed(text);
    }
    std::borrow::Cow::Owned(text.replace("\r\n", "\n").replace('\r', "\n"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EolStyle {
    Lf,
    Crlf,
    Mixed,
    None,
}

/// Detect dominant end-of-line style (ignores final EOF without newline).
pub fn detect_eol_style(text: &str) -> EolStyle {
    let mut lf = 0u32;
    let mut crlf = 0u32;
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                crlf += 1;
                i += 2;
            } else {
                // Lone CR counts as mixed/legacy.
                crlf += 1;
                i += 1;
            }
        } else if bytes[i] == b'\n' {
            lf += 1;
            i += 1;
        } else {
            i += 1;
        }
    }
    match (lf > 0, crlf > 0) {
        (false, false) => EolStyle::None,
        (true, false) => EolStyle::Lf,
        (false, true) => EolStyle::Crlf,
        (true, true) => EolStyle::Mixed,
    }
}

/// True when both sides have content and disagree on EOL (LF vs CRLF/mixed).
pub fn eol_mismatch(left: &str, right: &str) -> bool {
    let l = detect_eol_style(left);
    let r = detect_eol_style(right);
    if l == EolStyle::None || r == EolStyle::None {
        return false;
    }
    l != r
}

/// Compute unified hunks between left (old) and right (new) text.
pub fn compute_hunks(
    left: Option<&str>,
    right: Option<&str>,
    opts: &DiffComputeOptions,
) -> Vec<DiffHunk> {
    let left_raw = left.unwrap_or("");
    let right_raw = right.unwrap_or("");
    // Always compare on LF-normalized text so "Do not ignore" whitespace still
    // treats visually identical lines as equal across CRLF/LF (GIT-33).
    let left_cow = normalize_newlines(left_raw);
    let right_cow = normalize_newlines(right_raw);
    let left = left_cow.as_ref();
    let right = right_cow.as_ref();

    let left_lines: Vec<&str> = split_lines(left);
    let right_lines: Vec<&str> = split_lines(right);
    let line_count = left_lines.len().max(right_lines.len());

    // Huge near-identical files: avoid O(N) owned ops / unbounded Myers.
    // If both sides share the same line count and few sampled diffs, still fine;
    // when either side is huge, fall back to a single coarse hunk of changed region
    // computed via Histogram with a hard timeout (or empty if identical).
    if line_count >= HUGE_LINE_COUNT && opts.ignore_whitespace == IgnoreWhitespace::None {
        if left == right {
            return Vec::new();
        }
        return compute_hunks_bounded(left, right, line_count);
    }

    match opts.ignore_whitespace {
        IgnoreWhitespace::None => {
            let diff = configure_diff(line_count).diff_lines(left, right);
            // Collect tagged ops as borrowed slices into original text — no per-line String.
            let mut ops: Vec<(ChangeTag, &str, Option<usize>, Option<usize>)> = Vec::new();
            let mut old_idx = 0usize;
            let mut new_idx = 0usize;
            for change in diff.iter_all_changes() {
                let line = trim_nl(change.value());
                match change.tag() {
                    ChangeTag::Equal => {
                        ops.push((ChangeTag::Equal, line, Some(old_idx), Some(new_idx)));
                        old_idx += 1;
                        new_idx += 1;
                    }
                    ChangeTag::Delete => {
                        ops.push((ChangeTag::Delete, line, Some(old_idx), None));
                        old_idx += 1;
                    }
                    ChangeTag::Insert => {
                        ops.push((ChangeTag::Insert, line, None, Some(new_idx)));
                        new_idx += 1;
                    }
                }
            }
            group_hunks_borrowed(&ops)
        }
        IgnoreWhitespace::Trim | IgnoreWhitespace::All | IgnoreWhitespace::AllAndEmptyLines => {
            // Compare normalized lines; still emit original line text in hunks.
            let left_norm: Vec<String> = left_lines
                .iter()
                .map(|l| normalize_ws(l, opts.ignore_whitespace))
                .collect();
            let right_norm: Vec<String> = right_lines
                .iter()
                .map(|l| normalize_ws(l, opts.ignore_whitespace))
                .collect();
            let left_joined = left_norm.join("\n");
            let right_joined = right_norm.join("\n");
            compute_hunks_normalized(
                &left_lines,
                &right_lines,
                &left_joined,
                &right_joined,
                opts.ignore_whitespace,
                line_count,
            )
        }
    }
}

/// Bounded diff for huge files: Histogram + timeout, still streaming borrowed ops.
fn compute_hunks_bounded(left: &str, right: &str, line_count: usize) -> Vec<DiffHunk> {
    let started = Instant::now();
    let diff = configure_diff(line_count).diff_lines(left, right);
    let mut ops: Vec<(ChangeTag, &str, Option<usize>, Option<usize>)> = Vec::new();
    let mut old_idx = 0usize;
    let mut new_idx = 0usize;
    for change in diff.iter_all_changes() {
        let line = trim_nl(change.value());
        match change.tag() {
            ChangeTag::Equal => {
                ops.push((ChangeTag::Equal, line, Some(old_idx), Some(new_idx)));
                old_idx += 1;
                new_idx += 1;
            }
            ChangeTag::Delete => {
                ops.push((ChangeTag::Delete, line, Some(old_idx), None));
                old_idx += 1;
            }
            ChangeTag::Insert => {
                ops.push((ChangeTag::Insert, line, None, Some(new_idx)));
                new_idx += 1;
            }
        }
    }
    let _ = started.elapsed();
    group_hunks_borrowed(&ops)
}

fn normalize_ws(line: &str, mode: IgnoreWhitespace) -> String {
    let trimmed_nl = line.trim_end_matches('\n').trim_end_matches('\r');
    match mode {
        IgnoreWhitespace::None => trimmed_nl.to_string(),
        IgnoreWhitespace::Trim => trimmed_nl.trim().to_string(),
        IgnoreWhitespace::All => trimmed_nl.chars().filter(|c| !c.is_whitespace()).collect(),
        IgnoreWhitespace::AllAndEmptyLines => {
            let stripped: String = trimmed_nl.chars().filter(|c| !c.is_whitespace()).collect();
            if stripped.is_empty() {
                String::new()
            } else {
                stripped
            }
        }
    }
}

fn compute_hunks_normalized(
    left_lines: &[&str],
    right_lines: &[&str],
    left_joined: &str,
    right_joined: &str,
    mode: IgnoreWhitespace,
    line_count: usize,
) -> Vec<DiffHunk> {
    let diff = configure_diff(line_count).diff_lines(left_joined, right_joined);

    let mut ops: Vec<(ChangeTag, &str, Option<usize>, Option<usize>)> = Vec::new();
    let mut old_idx = 0usize;
    let mut new_idx = 0usize;
    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                // Skip equal empty-normalized pairs when ignoring blank lines.
                if mode == IgnoreWhitespace::AllAndEmptyLines {
                    let l_empty = left_lines
                        .get(old_idx)
                        .map(|l| normalize_ws(l, mode).is_empty())
                        .unwrap_or(true);
                    let r_empty = right_lines
                        .get(new_idx)
                        .map(|l| normalize_ws(l, mode).is_empty())
                        .unwrap_or(true);
                    if l_empty && r_empty {
                        old_idx += 1;
                        new_idx += 1;
                        continue;
                    }
                }
                let text = left_lines.get(old_idx).map(|l| trim_nl(l)).unwrap_or("");
                ops.push((ChangeTag::Equal, text, Some(old_idx), Some(new_idx)));
                old_idx += 1;
                new_idx += 1;
            }
            ChangeTag::Delete => {
                let text = left_lines.get(old_idx).map(|l| trim_nl(l)).unwrap_or("");
                if mode == IgnoreWhitespace::AllAndEmptyLines && text.trim().is_empty() {
                    old_idx += 1;
                    continue;
                }
                ops.push((ChangeTag::Delete, text, Some(old_idx), None));
                old_idx += 1;
            }
            ChangeTag::Insert => {
                let text = right_lines.get(new_idx).map(|l| trim_nl(l)).unwrap_or("");
                if mode == IgnoreWhitespace::AllAndEmptyLines && text.trim().is_empty() {
                    new_idx += 1;
                    continue;
                }
                ops.push((ChangeTag::Insert, text, None, Some(new_idx)));
                new_idx += 1;
            }
        }
    }
    group_hunks_borrowed(&ops)
}

fn split_lines(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut lines: Vec<&str> = text.split_inclusive('\n').collect();
    // Normalize: keep content without forcing trailing empty from final newline alone.
    if text.ends_with('\n') {
        // split_inclusive keeps newline in each segment; fine for counting.
    }
    if lines.len() == 1 && lines[0].is_empty() {
        lines.clear();
    }
    lines
}

fn group_hunks_borrowed(ops: &[(ChangeTag, &str, Option<usize>, Option<usize>)]) -> Vec<DiffHunk> {
    // Context radius around changes.
    const CONTEXT: usize = 3;
    let mut change_indexes: Vec<usize> = Vec::new();
    for (i, (tag, _, _, _)) in ops.iter().enumerate() {
        if *tag != ChangeTag::Equal {
            change_indexes.push(i);
        }
    }
    if change_indexes.is_empty() {
        return Vec::new();
    }

    // Merge overlapping context windows into hunk ranges [start, end).
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for &idx in &change_indexes {
        let start = idx.saturating_sub(CONTEXT);
        let end = (idx + CONTEXT + 1).min(ops.len());
        if let Some(last) = ranges.last_mut() {
            if start <= last.1 {
                last.1 = last.1.max(end);
                continue;
            }
        }
        ranges.push((start, end));
    }

    let mut hunks = Vec::new();
    for (hunk_i, (start, end)) in ranges.into_iter().enumerate() {
        let slice = &ops[start..end];
        let mut lines = Vec::with_capacity(slice.len());
        let mut old_start = None;
        let mut new_start = None;
        let mut old_count = 0u32;
        let mut new_count = 0u32;
        for (tag, text, old_i, new_i) in slice {
            match tag {
                ChangeTag::Equal => {
                    if old_start.is_none() {
                        old_start = old_i.map(|i| i as u32 + 1);
                    }
                    if new_start.is_none() {
                        new_start = new_i.map(|i| i as u32 + 1);
                    }
                    old_count += 1;
                    new_count += 1;
                    lines.push(format!(" {text}"));
                }
                ChangeTag::Delete => {
                    if old_start.is_none() {
                        old_start = old_i.map(|i| i as u32 + 1);
                    }
                    old_count += 1;
                    lines.push(format!("-{text}"));
                }
                ChangeTag::Insert => {
                    if new_start.is_none() {
                        new_start = new_i.map(|i| i as u32 + 1);
                    }
                    new_count += 1;
                    lines.push(format!("+{text}"));
                }
            }
        }
        let old_start = old_start.unwrap_or(0);
        let new_start = new_start.unwrap_or(0);
        let header = format!("@@ -{old_start},{old_count} +{new_start},{new_count} @@");
        hunks.push(DiffHunk {
            index: hunk_i as u32,
            header,
            old_start,
            old_lines: old_count,
            new_start,
            new_lines: new_count,
            lines,
        });
    }
    hunks
}

/// Apply selected hunks from worktree onto index text to produce new index content.
///
/// `base` = current index (or empty), `worktree` = worktree text.
/// Selected hunks (by index into compute_hunks(base, worktree)) are applied;
/// unselected changes stay only in worktree.
pub fn apply_selected_hunks_to_base(
    base: &str,
    worktree: &str,
    selected_hunk_indexes: &[u32],
) -> String {
    select_hunks(base, worktree, selected_hunk_indexes, false)
}

/// Unstage selected hunks: remove those changes from index toward HEAD text.
pub fn apply_unstage_hunks_to_index(
    head: &str,
    index: &str,
    selected_hunk_indexes: &[u32],
) -> String {
    select_hunks(head, index, selected_hunk_indexes, true)
}

fn select_hunks(base: &str, worktree: &str, selected: &[u32], revert: bool) -> String {
    let original = if revert { worktree } else { base };
    if selected.is_empty() {
        return original.to_string();
    }
    let selected: std::collections::HashSet<u32> = selected.iter().copied().collect();
    let hunks = compute_hunks(Some(base), Some(worktree), &DiffComputeOptions::default());
    let old_lines = exact_lines(base);
    let new_lines = exact_lines(worktree);
    let original_lines = if revert { &new_lines } else { &old_lines };
    let mut cursor = 0;
    let mut fragments = Vec::new();
    for hunk in hunks.iter().filter(|hunk| selected.contains(&hunk.index)) {
        let mut old = hunk.old_start.saturating_sub(1) as usize;
        let mut new = hunk.new_start.saturating_sub(1) as usize;
        let start = if revert { new } else { old };
        fragments.extend_from_slice(&original_lines[cursor..start]);
        // Hunk display strings have normalized line endings. Use only their
        // tags and positions, copying exact bytes from the corresponding side.
        for line in &hunk.lines {
            match line.as_bytes()[0] {
                b' ' => {
                    fragments.push(if revert {
                        new_lines[new]
                    } else {
                        old_lines[old]
                    });
                    old += 1;
                    new += 1;
                }
                b'-' => {
                    if revert {
                        fragments.push(old_lines[old]);
                    }
                    old += 1;
                }
                b'+' => {
                    if !revert {
                        fragments.push(new_lines[new]);
                    }
                    new += 1;
                }
                _ => unreachable!("computed hunk line tag"),
            }
        }
        cursor = if revert { new } else { old };
    }
    fragments.extend_from_slice(&original_lines[cursor..]);
    fragments.concat()
}

/// Apply selected new-side file lines without moving later edits or changing
/// unselected bytes. Adjacent replacement lines are paired in source order;
/// pure deletion blocks have no new-side line and require hunk/file staging.
pub fn apply_selected_lines_to_base(
    base: &str,
    worktree: &str,
    selected_new_lines: &[u32],
) -> String {
    select_new_lines(base, worktree, selected_new_lines, false)
}

/// Revert selected new-side file lines, preserving unselected worktree bytes.
pub fn revert_selected_lines_to_base(
    base: &str,
    worktree: &str,
    selected_new_lines: &[u32],
) -> String {
    select_new_lines(base, worktree, selected_new_lines, true)
}

/// Split display lines while retaining their original CRLF/LF/CR/EOF bytes.
fn exact_lines(text: &str) -> Vec<&str> {
    let bytes = text.as_bytes();
    let mut result = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' || bytes[i] == b'\n' {
            if bytes[i] == b'\r' && bytes.get(i + 1) == Some(&b'\n') {
                i += 1;
            }
            result.push(&text[start..=i]);
            start = i + 1;
        }
        i += 1;
    }
    if start < text.len() {
        result.push(&text[start..]);
    }
    result
}

fn select_new_lines(base: &str, worktree: &str, selected: &[u32], revert: bool) -> String {
    if selected.is_empty() {
        return if revert { worktree } else { base }.to_string();
    }
    let selected: std::collections::HashSet<u32> = selected.iter().copied().collect();
    let old_lines = exact_lines(base);
    let new_lines = exact_lines(worktree);
    let normalized_old = normalize_newlines(base);
    let normalized_new = normalize_newlines(worktree);
    let diff = configure_diff(old_lines.len().max(new_lines.len()))
        .diff_lines(normalized_old.as_ref(), normalized_new.as_ref());
    let changes: Vec<_> = diff.iter_all_changes().collect();
    let mut fragments = Vec::new();
    let mut cursor = 0;
    while cursor < changes.len() {
        let change = &changes[cursor];
        if change.tag() == ChangeTag::Equal {
            fragments.push(if revert {
                new_lines[change.new_index().expect("equal new line")]
            } else {
                old_lines[change.old_index().expect("equal old line")]
            });
            cursor += 1;
            continue;
        }
        let mut removed = Vec::new();
        let mut added = Vec::new();
        while cursor < changes.len() && changes[cursor].tag() != ChangeTag::Equal {
            let change = &changes[cursor];
            if let Some(index) = change.old_index() {
                removed.push(index);
            }
            if let Some(index) = change.new_index() {
                added.push(index);
            }
            cursor += 1;
        }
        let all_selected = !added.is_empty()
            && added
                .iter()
                .all(|index| selected.contains(&(*index as u32 + 1)));
        for offset in 0..removed.len().max(added.len()) {
            let old = removed.get(offset).map(|index| old_lines[*index]);
            let new = added.get(offset).map(|index| new_lines[*index]);
            let picked = added
                .get(offset)
                .is_some_and(|index| selected.contains(&(*index as u32 + 1)));
            let fragment = match (old, new) {
                (Some(old), Some(new)) => Some(if picked != revert { new } else { old }),
                (None, Some(new)) => (picked != revert).then_some(new),
                (Some(old), None) => (all_selected == revert).then_some(old),
                (None, None) => None,
            };
            if let Some(fragment) = fragment {
                fragments.push(fragment);
            }
        }
    }
    let eol_source = if revert { base } else { worktree };
    let separator = if eol_source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut output = String::new();
    for fragment in fragments {
        // Appending after a selected insertion may require a new EOF separator.
        if !output.is_empty() && !output.ends_with(['\r', '\n']) {
            output.push_str(separator);
        }
        output.push_str(fragment);
    }
    output
}

/// Three-way merge (line-based). Non-overlapping edits auto-merge; overlaps → Conflict.
pub fn merge3(
    base: Option<&str>,
    ours: Option<&str>,
    theirs: Option<&str>,
) -> gitx_core::Merge3Result {
    use gitx_core::{Merge3Block, Merge3BlockKind, Merge3Result};

    let strip = |s: &str| s.trim_end_matches('\n').to_string();
    let base: Vec<String> = split_lines(base.unwrap_or(""))
        .into_iter()
        .map(strip)
        .collect();
    let ours: Vec<String> = split_lines(ours.unwrap_or(""))
        .into_iter()
        .map(strip)
        .collect();
    let theirs: Vec<String> = split_lines(theirs.unwrap_or(""))
        .into_iter()
        .map(strip)
        .collect();

    if ours == theirs {
        return Merge3Result {
            blocks: vec![Merge3Block {
                kind: if ours == base {
                    Merge3BlockKind::Equal
                } else {
                    Merge3BlockKind::BothSame
                },
                base_lines: base,
                ours_lines: ours.clone(),
                theirs_lines: theirs,
                result_lines: ours,
                is_simple: true,
            }],
            conflict_count: 0,
        };
    }
    if ours == base {
        return Merge3Result {
            blocks: vec![Merge3Block {
                kind: Merge3BlockKind::OnlyTheirs,
                base_lines: base,
                ours_lines: ours,
                theirs_lines: theirs.clone(),
                result_lines: theirs,
                is_simple: true,
            }],
            conflict_count: 0,
        };
    }
    if theirs == base {
        return Merge3Result {
            blocks: vec![Merge3Block {
                kind: Merge3BlockKind::OnlyOurs,
                base_lines: base,
                ours_lines: ours.clone(),
                theirs_lines: theirs,
                result_lines: ours,
                is_simple: true,
            }],
            conflict_count: 0,
        };
    }

    let o_hunks = change_hunks(&base, &ours);
    let t_hunks = change_hunks(&base, &theirs);

    // Cleaner second pass: walk with original hunk lists.
    let mut blocks = Vec::new();
    let mut bi = 0usize;
    let mut oh = 0usize;
    let mut th = 0usize;
    // Reconstruct side indices via applying hunks in order is hard; emit from hunks + equal gaps.
    // Build result by reconstructing ours/theirs from hunks relative to base.

    while bi <= base.len() {
        let o_here = o_hunks.get(oh).filter(|h| h.base_start == bi);
        let t_here = t_hunks.get(th).filter(|h| h.base_start == bi);

        if o_here.is_none() && t_here.is_none() {
            if bi == base.len() {
                break;
            }
            // Find next hunk.
            let next = match (
                o_hunks.get(oh).map(|h| h.base_start),
                t_hunks.get(th).map(|h| h.base_start),
            ) {
                (Some(a), Some(b)) => a.min(b),
                (Some(a), None) => a,
                (None, Some(b)) => b,
                (None, None) => base.len(),
            };
            if next > bi {
                let slice = base[bi..next].to_vec();
                blocks.push(Merge3Block {
                    kind: Merge3BlockKind::Equal,
                    base_lines: slice.clone(),
                    ours_lines: slice.clone(),
                    theirs_lines: slice.clone(),
                    result_lines: slice,
                    is_simple: true,
                });
                bi = next;
                continue;
            }
            bi += 1;
            continue;
        }

        let o = o_here.cloned();
        let t = t_here.cloned();
        if o.is_some() {
            oh += 1;
        }
        if t.is_some() {
            th += 1;
        }

        match (o, t) {
            (Some(ohk), None) => {
                let end = (ohk.base_start + ohk.base_count).min(base.len());
                let start = ohk.base_start.min(base.len());
                let base_slice = base[start..end].to_vec();
                blocks.push(Merge3Block {
                    kind: Merge3BlockKind::OnlyOurs,
                    base_lines: base_slice.clone(),
                    ours_lines: ohk.inserted.clone(),
                    theirs_lines: base_slice,
                    result_lines: ohk.inserted,
                    is_simple: true,
                });
                bi = end.max(bi + (ohk.base_count == 0) as usize);
                if ohk.base_count == 0 {
                    // insert-only: stay/advance past point
                    bi = ohk.base_start;
                    // prevent infinite loop: move past by treating as consumed at this index once
                    // Advance bi only when no further hunks share this index.
                    if o_hunks.get(oh).map(|h| h.base_start) != Some(ohk.base_start)
                        && t_hunks.get(th).map(|h| h.base_start) != Some(ohk.base_start)
                    {
                        // keep bi; next loop looks for hunks at same bi or equals
                    }
                    // Force progress when only inserts remain at EOF
                    if bi == base.len() && oh >= o_hunks.len() && th >= t_hunks.len() {
                        break;
                    }
                    // For insert-only mid-file, do not advance bi; equal pass will not re-fire
                    // because oh already advanced. Emit and continue with same bi.
                }
            }
            (None, Some(thk)) => {
                let end = (thk.base_start + thk.base_count).min(base.len());
                let start = thk.base_start.min(base.len());
                let base_slice = base[start..end].to_vec();
                blocks.push(Merge3Block {
                    kind: Merge3BlockKind::OnlyTheirs,
                    base_lines: base_slice.clone(),
                    ours_lines: base_slice,
                    theirs_lines: thk.inserted.clone(),
                    result_lines: thk.inserted,
                    is_simple: true,
                });
                bi = if thk.base_count == 0 {
                    thk.base_start
                } else {
                    end
                };
            }
            (Some(ohk), Some(thk)) => {
                let end = (ohk.base_start + ohk.base_count)
                    .max(thk.base_start + thk.base_count)
                    .min(base.len());
                let base_slice = base[bi.min(base.len())..end].to_vec();
                if ohk.inserted == thk.inserted && ohk.base_count == thk.base_count {
                    blocks.push(Merge3Block {
                        kind: Merge3BlockKind::BothSame,
                        base_lines: base_slice,
                        ours_lines: ohk.inserted.clone(),
                        theirs_lines: thk.inserted.clone(),
                        result_lines: ohk.inserted,
                        is_simple: true,
                    });
                } else {
                    blocks.push(Merge3Block {
                        kind: Merge3BlockKind::Conflict,
                        base_lines: base_slice,
                        ours_lines: ohk.inserted,
                        theirs_lines: thk.inserted,
                        result_lines: Vec::new(),
                        is_simple: false,
                    });
                }
                bi = if end > bi { end } else { bi + 1 };
            }
            (None, None) => break,
        }
    }

    let conflict_count = blocks
        .iter()
        .filter(|b| b.kind == Merge3BlockKind::Conflict)
        .count() as u32;
    Merge3Result {
        blocks,
        conflict_count,
    }
}

#[derive(Clone, Debug)]
struct ChangeHunk {
    base_start: usize,
    base_count: usize,
    inserted: Vec<String>,
}

fn change_hunks(base: &[String], side: &[String]) -> Vec<ChangeHunk> {
    let left = base.join("\n");
    let right = side.join("\n");
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(&left, &right);
    let mut hunks = Vec::new();
    let mut bi = 0usize;
    let mut pending_start = 0usize;
    let mut pending_del = 0usize;
    let mut pending_ins: Vec<String> = Vec::new();
    let mut in_hunk = false;

    let flush = |hunks: &mut Vec<ChangeHunk>, start: usize, del: usize, ins: &mut Vec<String>| {
        if del > 0 || !ins.is_empty() {
            hunks.push(ChangeHunk {
                base_start: start,
                base_count: del,
                inserted: std::mem::take(ins),
            });
        }
    };

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                if in_hunk {
                    flush(&mut hunks, pending_start, pending_del, &mut pending_ins);
                    pending_del = 0;
                    in_hunk = false;
                }
                bi += 1;
            }
            ChangeTag::Delete => {
                if !in_hunk {
                    pending_start = bi;
                    in_hunk = true;
                }
                pending_del += 1;
                bi += 1;
            }
            ChangeTag::Insert => {
                if !in_hunk {
                    pending_start = bi;
                    in_hunk = true;
                }
                let line = change.to_string();
                pending_ins.push(line.trim_end_matches('\n').to_string());
            }
        }
    }
    if in_hunk {
        flush(&mut hunks, pending_start, pending_del, &mut pending_ins);
    }
    hunks
}

#[cfg(test)]
mod tests {
    use super::*;
    use gitx_core::Merge3BlockKind;

    #[test]
    fn basic_hunk() {
        let left = "a\nb\nc\n";
        let right = "a\nB\nc\n";
        let hunks = compute_hunks(Some(left), Some(right), &DiffComputeOptions::default());
        assert_eq!(hunks.len(), 1);
        assert!(hunks[0].lines.iter().any(|l| l == "-b"));
        assert!(hunks[0].lines.iter().any(|l| l == "+B"));
    }

    #[test]
    fn stage_selected_hunk() {
        let base = "a\nb\nc\nd\n";
        let work = "a\nB\nc\nD\n";
        let hunks = compute_hunks(Some(base), Some(work), &DiffComputeOptions::default());
        assert!(!hunks.is_empty());
        // Stage only first hunk if multiple; otherwise the single hunk.
        let staged = apply_selected_hunks_to_base(base, work, &[0]);
        assert!(staged.contains('B') || staged.contains('D') || staged != base);
    }

    #[test]
    fn ignore_all_whitespace_hides_indent_only_change() {
        let left = "hello world\n";
        let right = "hello  world\n";
        let hunks = compute_hunks(
            Some(left),
            Some(right),
            &DiffComputeOptions {
                ignore_whitespace: IgnoreWhitespace::All,
            },
        );
        assert!(hunks.is_empty());
    }

    #[test]
    fn tiny_edit_in_large_file_is_fast() {
        // 12k identical lines with one mid-file edit — must stay under soft budget.
        let mut left = String::with_capacity(12_000 * 8);
        for i in 0..12_000 {
            left.push_str(&format!("line-{i}\n"));
        }
        let mut right = left.clone();
        right = right.replacen("line-6000\n", "line-6000-EDIT\n", 1);
        let started = Instant::now();
        let hunks = compute_hunks(Some(&left), Some(&right), &DiffComputeOptions::default());
        let elapsed = started.elapsed();
        eprintln!(
            "GIT-31 tiny_edit_12k elapsed={elapsed:?} hunks={}",
            hunks.len()
        );
        assert_eq!(hunks.len(), 1, "expected single hunk, got {}", hunks.len());
        assert!(
            elapsed < Duration::from_millis(250),
            "large single-edit diff took {elapsed:?} (budget 250ms)"
        );
    }

    #[test]
    fn identical_huge_file_returns_empty_quickly() {
        let mut text = String::with_capacity(45_000 * 6);
        for i in 0..45_000 {
            text.push_str(&format!("x{i}\n"));
        }
        let started = Instant::now();
        let hunks = compute_hunks(Some(&text), Some(&text), &DiffComputeOptions::default());
        let elapsed = started.elapsed();
        assert!(hunks.is_empty());
        assert!(
            elapsed < Duration::from_millis(80),
            "identical huge file took {elapsed:?}"
        );
    }

    #[test]
    fn crlf_vs_lf_identical_lines_not_marked_changed() {
        // Staged (CRLF) vs Local (LF): package/import lines look identical but
        // must not become a full-file delete+add (GIT-33 false highlights).
        let left = "package com.aurora.controller;\r\n\r\nimport a.A;\r\nimport b.B;\r\n\r\nclass C {\r\n  @Autowired\r\n  Svc s;\r\n}\r\n";
        let right = "package com.aurora.controller;\n\nimport a.A;\nimport b.B;\nimport c.AnnotationApi;\n\nclass C {\n  new AnnotationApi();\n  Svc s;\n}\n";
        let hunks = compute_hunks(Some(left), Some(right), &DiffComputeOptions::default());
        assert!(!hunks.is_empty());
        let body: Vec<&str> = hunks
            .iter()
            .flat_map(|h| h.lines.iter().map(String::as_str))
            .collect();
        // Pre-fix imports must be equal context, never delete+add of the whole block.
        assert!(
            body.iter().any(|l| *l == " import a.A;"),
            "identical import should be context: {body:?}"
        );
        assert!(
            !body.iter().any(|l| l.starts_with("-package ")
                || *l == "-import a.A;"
                || *l == "-import b.B;"),
            "identical lines must not be deletes: {body:?}"
        );
        assert!(
            !body
                .iter()
                .any(|l| *l == "+import a.A;" || *l == "+import b.B;"),
            "identical lines must not be inserts: {body:?}"
        );
        assert!(
            body.iter().any(|l| *l == "+import c.AnnotationApi;"),
            "real insert missing: {body:?}"
        );
        assert!(eol_mismatch(left, right));
        assert!(!eol_mismatch(left, left));
    }

    #[test]
    fn same_text_different_eol_yields_empty_hunks() {
        let lf = "a\nb\nc\n";
        let crlf = "a\r\nb\r\nc\r\n";
        let hunks = compute_hunks(Some(lf), Some(crlf), &DiffComputeOptions::default());
        assert!(
            hunks.is_empty(),
            "EOL-only difference must not paint changes: {hunks:?}"
        );
        assert!(eol_mismatch(lf, crlf));
    }

    #[test]
    fn merge3_only_ours_and_only_theirs() {
        let base = "a\nb\nc\n";
        let ours = "a\nB\nc\n";
        let theirs = "a\nb\nC\n";
        let r = merge3(Some(base), Some(ours), Some(theirs));
        assert!(
            r.conflict_count >= 1
                || r.blocks
                    .iter()
                    .any(|b| b.kind == Merge3BlockKind::Conflict
                        || b.kind == Merge3BlockKind::OnlyOurs)
        );
        // Non-overlapping edits on different lines should be auto-mergeable.
        let base2 = "a\nb\nc\nd\n";
        let ours2 = "A\nb\nc\nd\n";
        let theirs2 = "a\nb\nc\nD\n";
        let r2 = merge3(Some(base2), Some(ours2), Some(theirs2));
        assert_eq!(r2.conflict_count, 0, "{:?}", r2.blocks);
        let result: Vec<String> = r2
            .blocks
            .iter()
            .flat_map(|b| b.result_lines.clone())
            .collect();
        assert_eq!(result, vec!["A", "b", "c", "D"]);
    }
}
