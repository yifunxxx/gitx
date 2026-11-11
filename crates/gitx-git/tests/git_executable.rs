use gitx_core::ErrorCode;
use gitx_git::{detect_git, test_git_executable};

#[test]
fn invalid_explicit_path_is_not_silently_replaced_with_installed_git() {
    let available = detect_git(None).expect("Git is required for this suite");
    assert!(available.supported);
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("missing-git.exe");
    let error = test_git_executable(missing.to_str().unwrap()).unwrap_err();
    assert_eq!(error.code, ErrorCode::GitNotFound);
    assert!(error.message.contains("missing-git.exe"));
}

#[test]
fn tests_exact_executable_and_empty_path_requests_discovery() {
    let available = test_git_executable("  ").unwrap();
    let explicit = test_git_executable(&format!("  {}  ", available.path)).unwrap();
    assert_eq!(explicit.path, available.path);
    assert_eq!(explicit.version, available.version);
}
