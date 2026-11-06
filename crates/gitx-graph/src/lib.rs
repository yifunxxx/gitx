//! Log graph layout (lane assignment / pagination) — stub for M0.

#[derive(Debug, Clone, Default)]
pub struct GraphLayoutStub;

impl GraphLayoutStub {
    pub fn placeholder_lanes(&self, commit_count: usize) -> Vec<u8> {
        vec![0; commit_count.min(100)]
    }
}
