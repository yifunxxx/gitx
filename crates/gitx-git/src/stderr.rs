use gitx_core::ErrorCode;

/// Maps common git stderr phrases to stable ErrorCode values (first batch for M0).
pub struct StderrClassifier;

impl StderrClassifier {
    pub fn classify(stderr: &str, exit_code: i32) -> ErrorCode {
        let s = stderr.to_lowercase();
        if s.contains("not a git repository") {
            return ErrorCode::NotARepository;
        }
        if s.contains("index.lock") || s.contains("unable to create") && s.contains("index.lock") {
            return ErrorCode::IndexLocked;
        }
        if s.contains("authentication failed") || s.contains("permission denied (publickey)") {
            return ErrorCode::GitCommandFailed;
        }
        if exit_code == 128 && s.contains("fatal") {
            return ErrorCode::GitCommandFailed;
        }
        ErrorCode::GitCommandFailed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_a_repo() {
        assert_eq!(
            StderrClassifier::classify("fatal: not a git repository", 128),
            ErrorCode::NotARepository
        );
    }
}
