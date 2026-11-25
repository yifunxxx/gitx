use gitx_core::{DiffHunk, HunkAnchor};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

/// Length-prefixed parts distinguish missing files, empty files and line joins.
pub fn content_token(parts: &[&[u8]]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u64).to_le_bytes());
        hash.update(part);
    }
    format!("{:x}", hash.finalize())
}

pub fn hunk_anchors(hunks: &[DiffHunk]) -> Vec<HunkAnchor> {
    hunks
        .iter()
        .map(|hunk| {
            let first = hunk
                .lines
                .iter()
                .position(|line| !line.starts_with(' '))
                .unwrap_or(0);
            let last = hunk
                .lines
                .iter()
                .rposition(|line| !line.starts_with(' '))
                .unwrap_or(first);
            // Include context between edits: a split/merged block must not be
            // mistaken for one old change just because +/- text is the same.
            let end = (last + 1).min(hunk.lines.len());
            let changes = hunk.lines[first..end]
                .iter()
                .map(|line| line.as_bytes())
                .collect::<Vec<_>>();
            HunkAnchor {
                before: hunk.lines[..first]
                    .iter()
                    .rev()
                    .take(3)
                    .rev()
                    .cloned()
                    .collect(),
                after: hunk.lines[end..].iter().take(3).cloned().collect(),
                change_hash: content_token(&changes),
                old_start: hunk.old_start,
                old_lines: hunk.old_lines,
                new_start: hunk.new_start,
                new_lines: hunk.new_lines,
            }
        })
        .collect()
}

/// Each old anchor maps to at most one new block. Ambiguous content is never
/// resolved by choosing the closest line number; callers must surface it.
pub fn map_hunk_anchors(old: &[HunkAnchor], new: &[HunkAnchor]) -> Vec<Option<usize>> {
    // Identical snapshots retain duplicate but unchanged blocks in place.
    if old == new {
        return (0..old.len()).map(Some).collect();
    }
    let mut by_hash: HashMap<&str, Vec<usize>> = HashMap::new();
    for (index, anchor) in new.iter().enumerate() {
        by_hash.entry(&anchor.change_hash).or_default().push(index);
    }
    let mut mapped = old
        .iter()
        .map(|anchor| {
            let candidates = by_hash.get(anchor.change_hash.as_str())?;
            let contextual = candidates
                .iter()
                .filter(|index| {
                    new[**index].before == anchor.before && new[**index].after == anchor.after
                })
                .copied()
                .collect::<Vec<_>>();
            if contextual.len() == 1 {
                Some(contextual[0])
            } else if candidates.len() == 1 {
                Some(candidates[0])
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    let mut seen = HashSet::new();
    let mut duplicated = HashSet::new();
    for index in mapped.iter().flatten() {
        if !seen.insert(*index) {
            duplicated.insert(*index);
        }
    }
    for index in &mut mapped {
        if index.is_some_and(|index| duplicated.contains(&index)) {
            *index = None;
        }
    }
    mapped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{compute_hunks, DiffComputeOptions};

    fn anchors(base: &str, work: &str) -> Vec<HunkAnchor> {
        hunk_anchors(&compute_hunks(
            Some(base),
            Some(work),
            &DiffComputeOptions::default(),
        ))
    }

    #[test]
    fn follows_unique_content_after_lines_are_inserted_above() {
        let base = (0..40).map(|i| format!("line{i}\n")).collect::<String>();
        let work = base.replace("line20\n", "changed\n");
        let old = anchors(&base, &work);
        let new = anchors(&base, &format!("new first line\n{work}"));
        assert_eq!(map_hunk_anchors(&old, &new), vec![Some(1)]);
    }

    #[test]
    fn changed_blocks_and_ambiguous_duplicates_require_review() {
        let a = anchors("a\n", "b\n")[0].clone();
        let mut shifted = a.clone();
        shifted.new_start += 10;
        assert_eq!(
            map_hunk_anchors(&[a.clone()], &[shifted.clone(), shifted]),
            vec![None]
        );
        let changed = anchors("a\n", "c\n");
        assert_eq!(map_hunk_anchors(&[a], &changed), vec![None]);
    }

    #[test]
    fn disappearance_does_not_transfer_ownership_and_duplicates_cannot_claim_one_block() {
        let a = anchors("a\n", "b\n")[0].clone();
        assert_eq!(map_hunk_anchors(&[a.clone()], &[]), vec![None]);
        assert_eq!(
            map_hunk_anchors(&[a.clone(), a.clone()], &[a]),
            vec![None, None]
        );
    }

    #[test]
    fn tokens_distinguish_file_absence_and_exact_line_endings() {
        assert_ne!(
            content_token(&[b"absent", b""]),
            content_token(&[b"present", b""])
        );
        assert_ne!(content_token(&[b"a\r\n"]), content_token(&[b"a\n"]));
        assert_ne!(content_token(&[b"a", b"bc"]), content_token(&[b"ab", b"c"]));
    }
}
