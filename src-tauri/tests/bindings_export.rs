#[path = "../src/bindings_export.rs"]
mod bindings_export;

use bindings_export::export_when_requested;
use std::fs;
use std::io;
use std::sync::{Arc, Barrier};

#[test]
fn normal_startup_never_runs_the_generator() {
    let exported = export_when_requested::<io::Error>(None, || {
        panic!("normal startup must not generate bindings")
    })
    .unwrap();
    assert!(!exported);
}

#[test]
fn an_empty_explicit_destination_is_an_error_without_running_the_generator() {
    assert!(export_when_requested::<io::Error>(Some("".into()), || {
        panic!("empty path must not invoke the generator")
    })
    .is_err());
}

#[test]
fn rendering_failure_preserves_the_existing_file_without_temporary_files() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("bindings.ts");
    fs::write(&dest, b"original types").unwrap();
    let error = export_when_requested(Some(dest.clone().into_os_string()), || {
        Err::<String, _>(io::Error::other("unsupported field"))
    })
    .unwrap_err();
    assert!(error.to_string().contains("unsupported field"));
    assert_eq!(fs::read(dest).unwrap(), b"original types");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn explicit_export_publishes_complete_utf8_content() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("bindings.ts");
    fs::write(&dest, b"old bindings").unwrap();
    let contents = "// 中文\nexport type Value = number;\n";
    assert!(
        export_when_requested(Some(dest.clone().into_os_string()), || {
            Ok::<_, io::Error>(contents.into())
        })
        .unwrap()
    );
    assert_eq!(fs::read_to_string(dest).unwrap(), contents);
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn failed_replacement_cleans_its_temporary_file_and_keeps_the_target_directory() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("bindings.ts");
    fs::create_dir(&dest).unwrap();
    fs::write(dest.join("keep.txt"), b"preserve").unwrap();
    assert!(
        export_when_requested(Some(dest.clone().into_os_string()), || {
            Ok::<_, io::Error>("export {}".into())
        })
        .is_err()
    );
    assert_eq!(fs::read(dest.join("keep.txt")).unwrap(), b"preserve");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn concurrent_exports_never_mix_content_or_leave_temporary_files() {
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("bindings.ts");
    let gate = Arc::new(Barrier::new(8));
    std::thread::scope(|scope| {
        let jobs: Vec<_> = (0..8)
            .map(|n| {
                let gate = gate.clone();
                let destination = dest.clone().into_os_string();
                scope.spawn(move || {
                    export_when_requested(Some(destination), || {
                        gate.wait();
                        Ok::<_, io::Error>(format!("writer-{n}\n").repeat(8192))
                    })
                    .unwrap();
                })
            })
            .collect();
        for job in jobs {
            job.join().unwrap();
        }
    });
    let contents = fs::read_to_string(dest).unwrap();
    assert!((0..8).any(|n| contents == format!("writer-{n}\n").repeat(8192)));
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[cfg(windows)]
#[test]
fn a_locked_destination_fails_boundedly_and_preserves_the_original() {
    use std::os::windows::fs::OpenOptionsExt;
    use std::time::{Duration, Instant};

    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("bindings.ts");
    fs::write(&dest, b"locked original").unwrap();
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&dest)
        .unwrap();
    let start = Instant::now();
    assert!(
        export_when_requested(Some(dest.clone().into_os_string()), || {
            Ok::<_, io::Error>("replacement".into())
        })
        .is_err()
    );
    assert!(start.elapsed() < Duration::from_secs(5));
    drop(lock);
    assert_eq!(fs::read(dest).unwrap(), b"locked original");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}
