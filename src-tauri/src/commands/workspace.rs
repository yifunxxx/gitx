use crate::state::AppState;
use gitx_core::{AppError, ErrorCode, JobHandle, JobKind, RepoId};
use gitx_git::OpKind;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOpenReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOpenRes {
    pub path: String,
    pub is_repo: bool,
    pub git_dir: Option<String>,
    pub toplevel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StatusProbeReq {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleLine {
    pub stream: String,
    pub line: String,
}

/// Open a folder and probe whether it is (inside) a git repository.
#[tauri::command]
#[specta::specta]
pub async fn workspace_open(
    state: State<'_, AppState>,
    req: WorkspaceOpenReq,
) -> Result<WorkspaceOpenRes, AppError> {
    let path = PathBuf::from(&req.path);
    if !path.is_dir() {
        return Err(AppError::new(
            ErrorCode::FsError,
            format!("not a directory: {}", req.path),
        ));
    }

    let git = state.git.read().await;
    let cancel = tokio_util::sync::CancellationToken::new();
    let inv = gitx_git::GitInvocation::new(
        &path,
        [
            "rev-parse",
            "--is-inside-work-tree",
            "--show-toplevel",
            "--git-dir",
        ],
    )
    .kind(OpKind::Read)
    .git_bin(git.git_bin.clone());

    match git.run(inv, &cancel).await {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            let mut lines = text.lines();
            let inside = lines.next().unwrap_or("false").trim() == "true";
            let toplevel = lines.next().map(|s| s.trim().to_string());
            let git_dir = lines.next().map(|s| s.trim().to_string());
            if let (Some(tl), Some(gd)) = (&toplevel, &git_dir) {
                state
                    .watcher
                    .watch(&RepoId::new(tl.clone()), PathBuf::from(tl).as_path());
                let _ = gd;
            }
            Ok(WorkspaceOpenRes {
                path: req.path,
                is_repo: inside,
                git_dir,
                toplevel,
            })
        }
        Err(err) => {
            if matches!(
                err.code,
                ErrorCode::GitCommandFailed | ErrorCode::NotARepository
            ) {
                Ok(WorkspaceOpenRes {
                    path: req.path,
                    is_repo: false,
                    git_dir: None,
                    toplevel: None,
                })
            } else {
                Err(err)
            }
        }
    }
}

/// Run `git status` as a Job and stream command/output to the Console via events.
#[tauri::command]
#[specta::specta]
pub async fn status_probe(
    app: AppHandle,
    state: State<'_, AppState>,
    req: StatusProbeReq,
) -> Result<JobHandle, AppError> {
    let path = PathBuf::from(&req.path);
    let repo_id = RepoId::new(req.path.clone());
    let job = state
        .jobs
        .start(
            JobKind::Read,
            "git status",
            vec![repo_id.clone()],
            true,
            false,
        )
        .await;

    let jobs = Arc::clone(&state.jobs);
    let git = Arc::clone(&state.git);
    let scheduler = Arc::clone(&state.scheduler);
    let job_id = job.info.id.clone();
    let job_title = job.info.title.clone();
    let cancel = job.cancel.clone();

    tauri::async_runtime::spawn(async move {
        let _ = app.emit(
            "job://started",
            serde_json::json!({
                "id": job_id.0,
                "title": job_title,
            }),
        );

        let runner = git.read().await;
        let cmd_display = format!(
            "{} -c core.quotepath=false -c color.ui=false --no-optional-locks status --porcelain=v2 -z --branch",
            runner.git_bin
        );
        jobs.emit_log(&job_id, "cmd", cmd_display.clone()).await;
        let _ = app.emit(
            "console://line",
            ConsoleLine {
                stream: "cmd".into(),
                line: cmd_display,
            },
        );

        let result = scheduler
            .with_permit(&repo_id.0, OpKind::Read, async {
                runner.status_probe(&path, &cancel).await
            })
            .await;

        match result {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                // porcelain -z: show a readable preview in Console
                let preview = stdout.replace('\0', "\n");
                for line in preview.lines() {
                    let line = line.to_string();
                    jobs.emit_log(&job_id, "stdout", line.clone()).await;
                    let _ = app.emit(
                        "console://line",
                        ConsoleLine {
                            stream: "stdout".into(),
                            line,
                        },
                    );
                }
                if !out.stderr.is_empty() {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    for line in stderr.lines() {
                        let line = line.to_string();
                        jobs.emit_log(&job_id, "stderr", line.clone()).await;
                        let _ = app.emit(
                            "console://line",
                            ConsoleLine {
                                stream: "stderr".into(),
                                line,
                            },
                        );
                    }
                }
                jobs.finish(&job_id, true, None, None).await;
                let _ = app.emit(
                    "job://finished",
                    serde_json::json!({ "id": job_id.0, "ok": true }),
                );
            }
            Err(err) => {
                let msg = err.message.clone();
                jobs.emit_log(&job_id, "stderr", msg.clone()).await;
                let _ = app.emit(
                    "console://line",
                    ConsoleLine {
                        stream: "stderr".into(),
                        line: msg,
                    },
                );
                let ok = matches!(err.code, ErrorCode::Cancelled);
                jobs.finish(&job_id, ok, Some(err), None).await;
                let _ = app.emit(
                    "job://finished",
                    serde_json::json!({ "id": job_id.0, "ok": ok }),
                );
            }
        }
    });

    Ok(JobHandle {
        job_id: job.info.id.clone(),
    })
}

use std::sync::Arc;
