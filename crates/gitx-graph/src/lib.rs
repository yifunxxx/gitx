//! Log graph lane layout for M1 basic Log.

use gitx_core::{GraphEdge, GraphRow};
use std::collections::HashMap;

/// Assign lanes for a page of commits (newest-first as returned by `git log`).
///
/// Parents that appear later in the list keep their lane; new parents open new lanes.
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
        // First parent continues on same lane; additional parents fork.
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
            color_of.entry(parent.clone()).or_insert(color);
        }

        // Clear current lane then place first parent there; place other parents.
        lanes[lane] = None;
        for (pi, parent) in parents.iter().enumerate() {
            let target = edges.get(pi).map(|e| e.to_lane as usize).unwrap_or(lane);
            if target >= lanes.len() {
                lanes.resize(target + 1, None);
            }
            lanes[target] = Some(parent.clone());
        }

        // Pass-through edges for active lanes not involved (simplified: omit for M1).
        let _ = &lanes;

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
    }
}
