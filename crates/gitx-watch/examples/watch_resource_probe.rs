use gitx_core::RepoId;
use gitx_watch::{RepoWatcher, WatchRoot};
use std::{io::Write, sync::Arc, time::Duration};

fn phase(name: &str, seconds: u64) {
    println!("{name}");
    std::io::stdout().flush().unwrap();
    std::thread::sleep(Duration::from_secs(seconds));
}

fn main() {
    let dirs = [tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap()];
    let roots: Vec<_> = dirs
        .iter()
        .enumerate()
        .map(|(index, dir)| {
            let git = dir.path().join(".git");
            std::fs::create_dir_all(git.join("refs/heads")).unwrap();
            WatchRoot::new(RepoId::new(index.to_string()), dir.path(), &git, &git)
        })
        .collect();
    let watcher = RepoWatcher::default();
    phase("baseline", 5);
    watcher
        .replace(1, vec![roots[0].clone()], Arc::new(|_| {}))
        .unwrap();
    phase("idle_watch", 10);
    for generation in 2..=101 {
        watcher
            .replace(
                generation,
                vec![roots[generation as usize % 2].clone()],
                Arc::new(|_| {}),
            )
            .unwrap();
    }
    phase("after_100_switches", 10);
    watcher.shutdown();
    phase("released", 10);
}
