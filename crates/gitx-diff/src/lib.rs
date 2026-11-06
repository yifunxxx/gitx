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

/// Compute unified hunks between left (old) and right (new) text.
pub fn compute_hunks(
    left: Option<&str>,
    right: Option<&str>,
    opts: &DiffComputeOptions,
) -> Vec<DiffHunk> {
    let left = left.unwrap_or("");
    let right = right.unwrap_or("");

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
    let hunks = compute_hunks(Some(base), Some(worktree), &DiffComputeOptions::default());
    if selected_hunk_indexes.is_empty() {
        return base.to_string();
    }
    let selected: std::collections::HashSet<u32> = selected_hunk_indexes.iter().copied().collect();

    // Rebuild by walking all hunks: for selected, take new side; for unselected, keep old side.
    // Approach: start from base lines, apply selected hunks in reverse order.
    let mut result_lines: Vec<String> = if base.is_empty() {
        Vec::new()
    } else {
        base.split_inclusive('\n')
            .map(|l| l.trim_end_matches('\n').to_string())
            .collect()
    };
    // If base ended with newline, split_inclusive keeps structure; normalize without empties from trailing.
    if base.ends_with('\n') && result_lines.last().is_some_and(|l| l.is_empty()) {
        result_lines.pop();
    }

    let mut selected_hunks: Vec<&DiffHunk> = hunks
        .iter()
        .filter(|h| selected.contains(&h.index))
        .collect();
    selected_hunks.sort_by_key(|h| std::cmp::Reverse(h.old_start));

    for hunk in selected_hunks {
        let start = if hunk.old_start == 0 {
            0
        } else {
            (hunk.old_start as usize).saturating_sub(1)
        };
        let end = start + hunk.old_lines as usize;
        let mut replacement: Vec<String> = Vec::new();
        for line in &hunk.lines {
            if let Some(rest) = line.strip_prefix('+') {
                replacement.push(rest.to_string());
            } else if let Some(rest) = line.strip_prefix(' ') {
                replacement.push(rest.to_string());
            }
            // '-' lines omitted
        }
        if end > result_lines.len() {
            // Fallback: append replacement.
            result_lines.extend(replacement);
        } else {
            result_lines.splice(start..end, replacement);
        }
    }

    if result_lines.is_empty() {
        return String::new();
    }
    let mut out = result_lines.join("\n");
    if worktree.ends_with('\n') || base.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// Unstage selected hunks: remove those changes from index toward HEAD text.
pub fn apply_unstage_hunks_to_index(
    head: &str,
    index: &str,
    selected_hunk_indexes: &[u32],
) -> String {
    // Hunks of head→index; unstaging selected means revert those hunks on index back toward head.
    let hunks = compute_hunks(Some(head), Some(index), &DiffComputeOptions::default());
    let selected: std::collections::HashSet<u32> = selected_hunk_indexes.iter().copied().collect();

    let mut result_lines: Vec<String> = if index.is_empty() {
        Vec::new()
    } else {
        index
            .split_inclusive('\n')
            .map(|l| l.trim_end_matches('\n').to_string())
            .collect()
    };
    if index.ends_with('\n') && result_lines.last().is_some_and(|l| l.is_empty()) {
        result_lines.pop();
    }

    // Map: for each selected hunk in head→index, the new side is in index.
    // Revert = replace new-side region with old-side lines.
    let mut selected_hunks: Vec<&DiffHunk> = hunks
        .iter()
        .filter(|h| selected.contains(&h.index))
        .collect();
    selected_hunks.sort_by_key(|h| std::cmp::Reverse(h.new_start));

    for hunk in selected_hunks {
        let start = if hunk.new_start == 0 {
            0
        } else {
            (hunk.new_start as usize).saturating_sub(1)
        };
        let end = start + hunk.new_lines as usize;
        let mut replacement: Vec<String> = Vec::new();
        for line in &hunk.lines {
            if let Some(rest) = line.strip_prefix('-') {
                replacement.push(rest.to_string());
            } else if let Some(rest) = line.strip_prefix(' ') {
                replacement.push(rest.to_string());
            }
        }
        if end > result_lines.len() {
            result_lines = replacement;
        } else {
            result_lines.splice(start..end, replacement);
        }
    }

    if result_lines.is_empty() {
        return String::new();
    }
    let mut out = result_lines.join("\n");
    if head.ends_with('\n') || index.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// Apply selected *new-side* line numbers (1-based) from worktree onto base.
///
/// For each hunk between base→worktree, only the `+` lines whose new-side line
/// number is in `selected_new_lines` are applied; other worktree changes stay out.
pub fn apply_selected_lines_to_base(
    base: &str,
    worktree: &str,
    selected_new_lines: &[u32],
) -> String {
    if selected_new_lines.is_empty() {
        return base.to_string();
    }
    let selected: std::collections::HashSet<u32> = selected_new_lines.iter().copied().collect();
    let hunks = compute_hunks(Some(base), Some(worktree), &DiffComputeOptions::default());

    // Collect hunk indexes that contain at least one selected new line.
    let mut partial_by_hunk: Vec<(u32, Vec<u32>)> = Vec::new();
    for h in &hunks {
        let mut lines_in_hunk = Vec::new();
        let mut new_line = h.new_start;
        for line in &h.lines {
            if line.starts_with('+') {
                if selected.contains(&new_line) {
                    lines_in_hunk.push(new_line);
                }
                new_line += 1;
            } else if line.starts_with(' ') {
                new_line += 1;
            }
            // '-' does not advance new_line
        }
        if !lines_in_hunk.is_empty() {
            // If every + line in the hunk is selected, apply whole hunk.
            let total_plus = h.lines.iter().filter(|l| l.starts_with('+')).count() as u32;
            if lines_in_hunk.len() as u32 == total_plus && h.old_lines > 0 {
                partial_by_hunk.push((h.index, Vec::new())); // empty = whole hunk
            } else if lines_in_hunk.len() as u32 == total_plus && h.old_lines == 0 {
                partial_by_hunk.push((h.index, Vec::new()));
            } else {
                partial_by_hunk.push((h.index, lines_in_hunk));
            }
        }
    }

    // Whole-hunk path for fully selected hunks.
    let whole: Vec<u32> = partial_by_hunk
        .iter()
        .filter(|(_, lines)| lines.is_empty())
        .map(|(idx, _)| *idx)
        .collect();
    let mut result = if whole.is_empty() {
        base.to_string()
    } else {
        apply_selected_hunks_to_base(base, worktree, &whole)
    };

    // Partial hunks: surgically insert only selected + lines.
    let mut partials: Vec<&DiffHunk> = hunks
        .iter()
        .filter(|h| {
            partial_by_hunk
                .iter()
                .any(|(idx, lines)| *idx == h.index && !lines.is_empty())
        })
        .collect();
    partials.sort_by_key(|h| std::cmp::Reverse(h.old_start));

    for hunk in partials {
        let sel_lines: Vec<u32> = partial_by_hunk
            .iter()
            .find(|(idx, _)| *idx == hunk.index)
            .map(|(_, l)| l.clone())
            .unwrap_or_default();
        let sel_set: std::collections::HashSet<u32> = sel_lines.iter().copied().collect();

        let mut result_lines: Vec<String> = if result.is_empty() {
            Vec::new()
        } else {
            result
                .split_inclusive('\n')
                .map(|l| l.trim_end_matches('\n').to_string())
                .collect()
        };
        if result.ends_with('\n') && result_lines.last().is_some_and(|l| l.is_empty()) {
            result_lines.pop();
        }

        // Build replacement for this hunk region: keep '-' (old) unless we have a
        // selected '+' that replaces; for pure additions, insert selected + lines
        // after the old_start position without deleting old lines that aren't paired.
        let start = if hunk.old_start == 0 {
            0
        } else {
            (hunk.old_start as usize).saturating_sub(1)
        };
        let end = start + hunk.old_lines as usize;

        let mut replacement: Vec<String> = Vec::new();
        let mut new_line = hunk.new_start;
        for line in &hunk.lines {
            if let Some(rest) = line.strip_prefix('+') {
                if sel_set.contains(&new_line) {
                    replacement.push(rest.to_string());
                }
                new_line += 1;
            } else if let Some(rest) = line.strip_prefix(' ') {
                replacement.push(rest.to_string());
                new_line += 1;
            } else if let Some(rest) = line.strip_prefix('-') {
                // Keep deleted line in base unless every change in hunk is selected
                // (handled by whole-hunk path). For partial, keep the old line.
                replacement.push(rest.to_string());
            }
        }

        if end > result_lines.len() {
            result_lines.extend(replacement);
        } else {
            result_lines.splice(start..end, replacement);
        }

        if result_lines.is_empty() {
            result = String::new();
        } else {
            let mut out = result_lines.join("\n");
            if worktree.ends_with('\n') || base.ends_with('\n') {
                out.push('\n');
            }
            result = out;
        }
    }

    result
}

/// Build target worktree text by reverting selected new-side lines toward base.
pub fn revert_selected_lines_to_base(
    base: &str,
    worktree: &str,
    selected_new_lines: &[u32],
) -> String {
    // Inverse of staging selected lines: keep worktree except selected changes → base.
    if selected_new_lines.is_empty() {
        return worktree.to_string();
    }
    let selected: std::collections::HashSet<u32> = selected_new_lines.iter().copied().collect();
    let hunks = compute_hunks(Some(base), Some(worktree), &DiffComputeOptions::default());

    let mut result_lines: Vec<String> = if worktree.is_empty() {
        Vec::new()
    } else {
        worktree
            .split_inclusive('\n')
            .map(|l| l.trim_end_matches('\n').to_string())
            .collect()
    };
    if worktree.ends_with('\n') && result_lines.last().is_some_and(|l| l.is_empty()) {
        result_lines.pop();
    }

    let mut selected_hunks: Vec<&DiffHunk> = hunks
        .iter()
        .filter(|h| {
            let mut new_line = h.new_start;
            for line in &h.lines {
                if line.starts_with('+') {
                    if selected.contains(&new_line) {
                        return true;
                    }
                    new_line += 1;
                } else if line.starts_with(' ') {
                    new_line += 1;
                }
            }
            // Also: pure deletions (no +) — treat entire hunk as selected if any
            // overlapping concept; for line-level we only handle + lines here.
            false
        })
        .collect();
    selected_hunks.sort_by_key(|h| std::cmp::Reverse(h.new_start));

    for hunk in selected_hunks {
        let start = if hunk.new_start == 0 {
            0
        } else {
            (hunk.new_start as usize).saturating_sub(1)
        };
        let end = start + hunk.new_lines as usize;
        let mut replacement: Vec<String> = Vec::new();
        let mut new_line = hunk.new_start;
        for line in &hunk.lines {
            if let Some(rest) = line.strip_prefix('-') {
                replacement.push(rest.to_string());
            } else if let Some(rest) = line.strip_prefix(' ') {
                replacement.push(rest.to_string());
                new_line += 1;
            } else if let Some(rest) = line.strip_prefix('+') {
                if !selected.contains(&new_line) {
                    replacement.push(rest.to_string());
                }
                new_line += 1;
            }
        }
        if end > result_lines.len() {
            result_lines = replacement;
        } else {
            result_lines.splice(start..end, replacement);
        }
    }

    if result_lines.is_empty() {
        return String::new();
    }
    let mut out = result_lines.join("\n");
    if worktree.ends_with('\n') || base.ends_with('\n') {
        out.push('\n');
    }
    out
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
