//! Read-path backend stub. M1+ will add gix + CLI dual implementations.

/// Placeholder trait for read backends (rev-walk, blob, refs).
pub trait GitReadBackend: Send + Sync {
    fn name(&self) -> &'static str;
}

/// Stub that always reports as unavailable so callers fall back to CLI.
pub struct StubReadBackend;

impl GitReadBackend for StubReadBackend {
    fn name(&self) -> &'static str {
        "stub"
    }
}
