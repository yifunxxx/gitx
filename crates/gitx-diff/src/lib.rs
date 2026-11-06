//! Diff / merge3 / partial-stage construction stubs for M0.

#[derive(Debug, Clone, Default)]
pub struct DiffEngineStub;

impl DiffEngineStub {
    pub fn is_ready(&self) -> bool {
        false
    }
}
