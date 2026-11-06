//! Text diff + hunk construction for M1 DiffViewer / hunk stage.

use gitx_core::{DiffHunk, IgnoreWhitespace};
use similar::{Algorithm, ChangeTag, TextDiff};

const TOO_LARGE_BYTES: usize = 5 * 1024 * 1024;

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

    let diff = match opts.ignore_whitespace {
        IgnoreWhitespace::None => TextDiff::configure()
            .algorithm(Algorithm::Myers)
            .diff_lines(left, right),
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
            // Build ops from normalized equality, then map back to original lines below.
            return compute_hunks_normalized(
                &left_lines,
                &right_lines,
                &left_joined,
                &right_joined,
                opts.ignore_whitespace,
            );
        }
    };
    let _ = left_lines;
    let _ = right_lines;

    // Collect tagged ops with line numbers.
    let mut ops: Vec<(ChangeTag, String, Option<usize>, Option<usize>)> = Vec::new();
    let mut old_idx = 0usize;
    let mut new_idx = 0usize;
    for change in diff.iter_all_changes() {
        let value = change.to_string();
        // similar's to_string keeps trailing newline; strip for storage, re-add marker.
        let line = value.trim_end_matches('\n').to_string();
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

    group_hunks(&ops)
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
) -> Vec<DiffHunk> {
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(left_joined, right_joined);

    let mut ops: Vec<(ChangeTag, String, Option<usize>, Option<usize>)> = Vec::new();
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
                let text = left_lines
                    .get(old_idx)
                    .map(|l| l.trim_end_matches('\n').trim_end_matches('\r').to_string())
                    .unwrap_or_default();
                ops.push((ChangeTag::Equal, text, Some(old_idx), Some(new_idx)));
                old_idx += 1;
                new_idx += 1;
            }
            ChangeTag::Delete => {
                let text = left_lines
                    .get(old_idx)
                    .map(|l| l.trim_end_matches('\n').trim_end_matches('\r').to_string())
                    .unwrap_or_default();
                if mode == IgnoreWhitespace::AllAndEmptyLines && text.trim().is_empty() {
                    old_idx += 1;
                    continue;
                }
                ops.push((ChangeTag::Delete, text, Some(old_idx), None));
                old_idx += 1;
            }
            ChangeTag::Insert => {
                let text = right_lines
                    .get(new_idx)
                    .map(|l| l.trim_end_matches('\n').trim_end_matches('\r').to_string())
                    .unwrap_or_default();
                if mode == IgnoreWhitespace::AllAndEmptyLines && text.trim().is_empty() {
                    new_idx += 1;
                    continue;
                }
                ops.push((ChangeTag::Insert, text, None, Some(new_idx)));
                new_idx += 1;
            }
        }
    }
    group_hunks(&ops)
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

fn group_hunks(ops: &[(ChangeTag, String, Option<usize>, Option<usize>)]) -> Vec<DiffHunk> {
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
        let mut lines = Vec::new();
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
