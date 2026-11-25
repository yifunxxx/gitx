//! Opt-in real Git measurement. Run alone with GIT_TRACE2_EVENT and
//! GITX_QA_COST_OUTPUT pointing to fresh files outside the repository.
use gitx_core::PathAssignment;
use gitx_git::{GitInvocation, GitRunner};
use gitx_testkit::FixtureBuilder;
use std::{path::Path, time::Instant};
use tokio_util::sync::CancellationToken;

async fn git(cwd: &Path, args: &[&str]) {
    GitRunner::new("git")
        .run(
            GitInvocation::new(cwd, args.iter().copied()),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
}
fn calls(trace: &Path) -> usize {
    std::fs::read_to_string(trace)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter(|event| event["event"] == "start")
        .count()
}

#[tokio::test]
#[ignore = "manual bounded refresh measurement, requires isolated trace/output files"]
async fn measure_changelist_refresh_cost() {
    let trace = std::path::PathBuf::from(std::env::var("GIT_TRACE2_EVENT").unwrap());
    let output = std::path::PathBuf::from(std::env::var("GITX_QA_COST_OUTPUT").unwrap());
    assert!(!output.exists(), "preserve earlier measurement");
    let mut samples = Vec::new();
    for count in [1, 32, 128] {
        let repo = FixtureBuilder::new().build("clean").unwrap();
        let cwd = repo.path();
        git(cwd, &["config", "core.autocrlf", "false"]).await;
        let base = (0..46).map(|i| format!("line {i}\n")).collect::<String>();
        let work = base
            .replace("line 12\n", "first change\n")
            .replace("line 35\n", "second change\n");
        let hunks = gitx_diff::compute_hunks(Some(&base), Some(&work), &Default::default());
        let anchors = gitx_diff::hunk_anchors(&hunks);
        let paths = (0..count)
            .map(|i| format!("file-{i:04}.txt"))
            .collect::<Vec<_>>();
        for path in &paths {
            std::fs::write(cwd.join(path), &base).unwrap();
        }
        git(cwd, &["add", "."]).await;
        git(cwd, &["commit", "-m", "base"]).await;
        let mut state = gitx_meta::load_changelists(&cwd.join(".git")).unwrap();
        state.assignments = paths
            .iter()
            .map(|path| PathAssignment {
                path: path.clone(),
                list_id: "default".into(),
                hunk_ranges: anchors.clone(),
            })
            .collect();
        std::fs::create_dir_all(cwd.join(".git/gitx")).unwrap();
        std::fs::write(
            cwd.join(".git/gitx/changelists.json"),
            serde_json::to_vec(&state).unwrap(),
        )
        .unwrap();
        for path in &paths {
            std::fs::write(cwd.join(path), &work).unwrap();
        }
        let runner = GitRunner::new("git");
        for phase in ["dirty", "committed"] {
            if phase == "committed" {
                git(cwd, &["add", "."]).await;
                git(cwd, &["commit", "-m", "all changes"]).await;
            }
            for round in 0..3 {
                let before = calls(&trace);
                let start = Instant::now();
                let result = runner
                    .changelist_resolve(cwd, &CancellationToken::new())
                    .await
                    .unwrap();
                let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
                assert_eq!(result.partial_files.len(), count);
                assert!(result.warnings.is_empty());
                assert!(result
                    .partial_files
                    .iter()
                    .all(|file| file.hunks.len() == if phase == "dirty" { 2 } else { 0 }));
                let sample = serde_json::json!({"files":count,"phase":phase,"round":round,"elapsedMs":elapsed_ms,"gitCalls":calls(&trace)-before});
                println!("QA_COST {sample}");
                samples.push(sample);
            }
        }
    }
    std::fs::write(output, serde_json::to_vec_pretty(&samples).unwrap()).unwrap();
}
