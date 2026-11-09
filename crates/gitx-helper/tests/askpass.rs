use gitx_core::CredentialSession;
use std::process::Command;

#[test]
fn executable_reads_the_same_session_format_as_the_app() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("session.json");
    let session = CredentialSession {
        origin: "https://example.test:8443".into(),
        username: "qa".into(),
        password: "synthetic-test-secret".into(),
    };
    std::fs::write(&path, serde_json::to_vec(&session).unwrap()).unwrap();
    for (prompt, expected) in [
        (
            "Username for 'https://example.test:8443': ",
            Some(session.username.as_str()),
        ),
        (
            "Password for 'https://qa@example.test:8443': ",
            Some(session.password.as_str()),
        ),
        ("Password for 'https://qa@other.test:8443': ", None),
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_gitx-helper"))
            .arg(prompt)
            .env("GITX_ASKPASS_FILE", &path)
            .output()
            .unwrap();
        if let Some(expected) = expected {
            assert!(output.status.success());
            assert_eq!(
                String::from_utf8(output.stdout).unwrap().trim_end(),
                expected
            );
            assert!(output.stderr.is_empty());
        } else {
            assert!(!output.status.success());
            assert!(output.stdout.is_empty());
        }
    }
}
