//! Log graph lane layout for commit history (IDEA-like multi-branch graph).

use gitx_core::{GraphEdge, GraphRow};
use std::collections::HashMap;

/// Assign lanes for a page of commits (newest-first as returned by `git log`).
///
/// Parents that appear later in the list keep their lane; new parents open new lanes.
/// Through-edges keep inactive-but-occupied lanes as vertical spines across the row.
pub fn layout_graph(commits: &[(String, Vec<String>)]) -> Vec<GraphRow> {
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut color_of: HashMap<String, u32> = HashMap::new();
    let mut next_color: u32 = 0;
    let mut rows = Vec::with_capacity(commits.len());

    for (sha, parents) in commits {
        // Find existing lane for this commit.
        let lane = lanes
            .iter()
            .position(|c| c.as_ref() == Some(sha))
            .unwrap_or_else(|| {
                if let Some(free) = lanes.iter().position(|c| c.is_none()) {
                    free
                } else {
                    lanes.push(None);
                    lanes.len() - 1
                }
            });
        if lane >= lanes.len() {
            lanes.resize(lane + 1, None);
        }
        lanes[lane] = Some(sha.clone());

        let color = *color_of.entry(sha.clone()).or_insert_with(|| {
            let c = next_color;
            next_color = (next_color + 1) % 12;
            c
        });

        let mut edges = Vec::new();

        // Through-edges: other occupied lanes continue vertically past this row.
        for (i, slot) in lanes.iter().enumerate() {
            if i != lane && slot.is_some() {
                edges.push(GraphEdge {
                    from_lane: i as u32,
                    to_lane: i as u32,
                });
            }
        }

        // First parent continues on same lane; additional parents fork / join.
        for (pi, parent) in parents.iter().enumerate() {
            let target_lane = if pi == 0 {
                lane
            } else if let Some(existing) = lanes.iter().position(|c| c.as_ref() == Some(parent)) {
                existing
            } else if let Some(free) = lanes.iter().position(|c| c.is_none()) {
                free
            } else {
                lanes.push(None);
                lanes.len() - 1
            };
            if target_lane >= lanes.len() {
                lanes.resize(target_lane + 1, None);
            }
            edges.push(GraphEdge {
                from_lane: lane as u32,
                to_lane: target_lane as u32,
            });
            color_of.entry(parent.clone()).or_insert(if pi == 0 {
                color
            } else {
                let c = next_color;
                next_color = (next_color + 1) % 12;
                c
            });
        }

        // Clear current lane then place parents.
        lanes[lane] = None;
        for (pi, parent) in parents.iter().enumerate() {
            let target = edges
                .iter()
                .filter(|e| e.from_lane == lane as u32)
                .nth(pi)
                .map(|e| e.to_lane as usize)
                .unwrap_or(lane);
            if target >= lanes.len() {
                lanes.resize(target + 1, None);
            }
            // Prefer keeping an existing reservation for the same parent.
            if let Some(existing) = lanes.iter().position(|c| c.as_ref() == Some(parent)) {
                if existing != target && pi > 0 {
                    // Already reserved elsewhere; edge already points there.
                    continue;
                }
            }
            lanes[target] = Some(parent.clone());
        }

        // Trim trailing empty lanes for denser columns.
        while lanes.last().is_some_and(|c| c.is_none()) {
            lanes.pop();
        }

        rows.push(GraphRow {
            lane: lane as u32,
            edges,
            color,
        });
    }

    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linear_history_stays_lane_zero() {
        let commits = vec![
            ("c3".into(), vec!["c2".into()]),
            ("c2".into(), vec!["c1".into()]),
            ("c1".into(), vec![]),
        ];
        let rows = layout_graph(&commits);
        assert_eq!(rows.len(), 3);
        assert!(rows.iter().all(|r| r.lane == 0));
        // Tip → parent continues on lane 0.
        assert!(rows[0]
            .edges
            .iter()
            .any(|e| e.from_lane == 0 && e.to_lane == 0));
    }

    #[test]
    fn merge_opens_second_lane() {
        // Newest-first: merge M of (a, b), then a, then b, then root.
        //   M
        //   |\
        //   a b
        //   |/
        //   r
        let commits = vec![
            ("M".into(), vec!["a".into(), "b".into()]),
            ("a".into(), vec!["r".into()]),
            ("b".into(), vec!["r".into()]),
            ("r".into(), vec![]),
        ];
        let rows = layout_graph(&commits);
        assert_eq!(rows[0].lane, 0);
        assert!(
            rows[0]
                .edges
                .iter()
                .any(|e| e.from_lane == 0 && e.to_lane != 0),
            "merge should emit a fork edge to a second lane: {:?}",
            rows[0].edges
        );
        // Second parent tip `b` should appear on a non-zero lane (or be joined).
        let b_row = &rows[2];
        assert!(
            b_row.lane > 0 || rows[1].edges.iter().any(|e| e.to_lane != e.from_lane),
            "branch lane expected, got lane={} edges={:?}",
            b_row.lane,
            b_row.edges
        );
    }

    #[test]
    fn through_edge_keeps_parallel_spine() {
        let commits = vec![
            ("tip".into(), vec!["a".into(), "b".into()]),
            ("a".into(), vec!["a0".into()]),
            ("b".into(), vec!["b0".into()]),
            ("a0".into(), vec![]),
            ("b0".into(), vec![]),
        ];
        let rows = layout_graph(&commits);
        // While walking `a`, lane for `b` should still be through.
        let a_row = &rows[1];
        assert!(
            a_row
                .edges
                .iter()
                .any(|e| e.from_lane != a_row.lane && e.from_lane == e.to_lane),
            "expected through-edge on sibling lane: {:?}",
            a_row.edges
        );
    }
}
