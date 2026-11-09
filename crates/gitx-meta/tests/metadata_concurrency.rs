use gitx_meta::{
    create_changelist, load_changelists, load_favorites, move_paths, rename_favorite,
    save_favorites, toggle_favorite,
};
use std::sync::{Arc, Barrier};

#[test]
fn simultaneous_changelist_creates_keep_every_list_and_one_active_list() {
    let dir = tempfile::tempdir().unwrap();
    let gate = Arc::new(Barrier::new(16));
    let results = std::thread::scope(|scope| {
        let jobs: Vec<_> = (0..16)
            .map(|n| {
                let gate = gate.clone();
                let path = dir.path();
                scope.spawn(move || {
                    gate.wait();
                    create_changelist(path, &format!("list-{n}"), "", true)
                })
            })
            .collect();
        jobs.into_iter()
            .map(|j| j.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert!(results.iter().all(Result::is_ok), "{results:?}");
    let saved = load_changelists(dir.path()).unwrap();
    assert_eq!(saved.lists.len(), 17);
    for n in 0..16 {
        assert!(saved.lists.iter().any(|l| l.name == format!("list-{n}")));
    }
    assert_eq!(saved.lists.iter().filter(|l| l.active).count(), 1);
}

#[test]
fn simultaneous_moves_preserve_assignments_from_every_operation() {
    let dir = tempfile::tempdir().unwrap();
    let state = create_changelist(dir.path(), "target", "", false).unwrap();
    let target = state
        .lists
        .iter()
        .find(|l| l.name == "target")
        .unwrap()
        .id
        .clone();
    let gate = Arc::new(Barrier::new(16));
    let results = std::thread::scope(|scope| {
        let jobs: Vec<_> = (0..16)
            .map(|n| {
                let gate = gate.clone();
                let path = dir.path();
                let target = &target;
                scope.spawn(move || {
                    gate.wait();
                    move_paths(path, &[format!("file-{n}.txt")], target)
                })
            })
            .collect();
        jobs.into_iter()
            .map(|j| j.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert!(results.iter().all(Result::is_ok), "{results:?}");
    let saved = load_changelists(dir.path()).unwrap();
    assert_eq!(saved.assignments.len(), 16);
    assert!(saved.assignments.iter().all(|a| a.list_id == target));
}

#[test]
fn favorite_toggles_and_rename_keep_unrelated_entries_across_directory_aliases() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("child")).unwrap();
    let alias = dir.path().join("child/..");
    save_favorites(
        dir.path(),
        &["refs/heads/hidden".into(), "refs/heads/old".into()],
    )
    .unwrap();
    let gate = Arc::new(Barrier::new(17));
    std::thread::scope(|scope| {
        let mut jobs = Vec::new();
        for n in 0..16 {
            let gate = gate.clone();
            let path = if n % 2 == 0 {
                dir.path()
            } else {
                alias.as_path()
            };
            jobs.push(scope.spawn(move || {
                gate.wait();
                toggle_favorite(path, &format!("refs/heads/branch-{n}"))
            }));
        }
        let path = dir.path();
        jobs.push(scope.spawn(move || {
            gate.wait();
            rename_favorite(path, "old", "renamed")
        }));
        for job in jobs {
            job.join().unwrap().unwrap();
        }
    });
    let saved = load_favorites(dir.path()).unwrap();
    assert_eq!(saved.len(), 18);
    assert!(saved.contains(&"refs/heads/hidden".into()));
    assert!(saved.contains(&"refs/heads/renamed".into()));
    assert!(!saved.contains(&"refs/heads/old".into()));
    assert_eq!(
        std::fs::read_dir(dir.path().join("gitx")).unwrap().count(),
        1
    );
}

#[test]
fn repeated_concurrent_toggles_preserve_parity() {
    let dir = tempfile::tempdir().unwrap();
    let gate = Arc::new(Barrier::new(16));
    std::thread::scope(|scope| {
        let jobs: Vec<_> = (0..16)
            .map(|_| {
                let gate = gate.clone();
                let path = dir.path();
                scope.spawn(move || {
                    gate.wait();
                    toggle_favorite(path, "refs/heads/main").unwrap();
                })
            })
            .collect();
        for job in jobs {
            job.join().unwrap();
        }
    });
    assert!(load_favorites(dir.path()).unwrap().is_empty());
}

#[test]
fn corrupt_or_unreadable_metadata_is_never_replaced_by_empty_state() {
    let dir = tempfile::tempdir().unwrap();
    let meta = gitx_meta::ensure_meta_dir(dir.path()).unwrap();
    for filename in ["favorites.json", "changelists.json"] {
        std::fs::write(meta.join(filename), b"corrupt, preserve these bytes").unwrap();
    }
    assert!(toggle_favorite(dir.path(), "refs/heads/main").is_err());
    assert!(rename_favorite(dir.path(), "main", "new").is_err());
    assert!(create_changelist(dir.path(), "new", "", true).is_err());
    for filename in ["favorites.json", "changelists.json"] {
        assert_eq!(
            std::fs::read(meta.join(filename)).unwrap(),
            b"corrupt, preserve these bytes"
        );
    }
    assert_eq!(std::fs::read_dir(&meta).unwrap().count(), 2);
    let unreadable = tempfile::tempdir().unwrap();
    let meta = gitx_meta::ensure_meta_dir(unreadable.path()).unwrap();
    std::fs::create_dir(meta.join("favorites.json")).unwrap();
    assert!(toggle_favorite(unreadable.path(), "refs/heads/main").is_err());
    assert!(meta.join("favorites.json").is_dir());
    assert_eq!(std::fs::read_dir(&meta).unwrap().count(), 1);
}

#[test]
fn concurrent_readers_only_observe_complete_metadata_versions() {
    let dir = tempfile::tempdir().unwrap();
    save_favorites(dir.path(), &["refs/heads/keep".into()]).unwrap();
    std::thread::scope(|scope| {
        let path = dir.path();
        let writer = scope.spawn(move || {
            for _ in 0..100 {
                toggle_favorite(path, "refs/heads/main").unwrap();
            }
        });
        for _ in 0..500 {
            let saved = load_favorites(dir.path()).unwrap();
            assert!(saved.contains(&"refs/heads/keep".into()));
            assert!(saved.len() == 1 || saved.len() == 2);
        }
        writer.join().unwrap();
    });
}

#[test]
fn settings_readers_observe_one_complete_saved_version() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let state = gitx_core::AppSettings {
        git_executable: Some("version-0".into()),
        recent_workspaces: vec!["version-0".into()],
        ..Default::default()
    };
    gitx_meta::save_app_settings(&path, &state).unwrap();
    std::thread::scope(|scope| {
        let path = &path;
        let writer = scope.spawn(move || {
            for n in 1..100 {
                let state = gitx_core::AppSettings {
                    git_executable: Some(format!("version-{n}")),
                    recent_workspaces: vec![format!("version-{n}")],
                    ..Default::default()
                };
                gitx_meta::save_app_settings(path, &state).unwrap();
            }
        });
        for _ in 0..500 {
            let state = gitx_meta::load_app_settings(path).unwrap();
            assert_eq!(
                state.git_executable.as_ref(),
                state.recent_workspaces.first()
            );
        }
        writer.join().unwrap();
    });
}

#[test]
fn failed_favorite_replace_preserves_target_and_cleans_temporary_file() {
    let dir = tempfile::tempdir().unwrap();
    let metadata = gitx_meta::ensure_meta_dir(dir.path()).unwrap();
    let target = metadata.join("favorites.json");
    std::fs::create_dir(&target).unwrap();
    assert!(save_favorites(dir.path(), &["refs/heads/main".into()]).is_err());
    assert!(target.is_dir());
    assert_eq!(std::fs::read_dir(&metadata).unwrap().count(), 1);
}
