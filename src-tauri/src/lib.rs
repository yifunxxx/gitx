#![allow(clippy::result_large_err)]

mod commands;
mod state;

use commands::app::{
    app_info, git_detect, git_test_executable, log_frontend, settings_get, settings_reload,
    settings_set,
};
use commands::changelist::{
    changelist_create, changelist_delete, changelist_list, changelist_move, changelist_rename,
    changelist_set_active,
};
use commands::clone_cmd::{clone_check_url, clone_run, repo_state_get, unshallow_run};
use commands::commit::{commit_create, commit_head_message};
use commands::compare::{diff_combined, diff_file_at, diff_refs};
use commands::conflicts::{
    conflict_accept_side, conflict_mark_resolved, conflict_merge3, conflict_resolve_simple,
    conflict_save_result, conflict_versions, conflicts_list,
};
use commands::credential::{credential_session_clear, credential_session_set};
use commands::diff::diff_file;
use commands::history::{
    blame_file, blob_read, checkout_path_from_rev, file_history, list_refs, log_changed_files,
    log_commit_details, log_index_rebuild, log_index_status, log_locate, log_query, tree_list,
};
use commands::ignore::{exclude_open, ignore_add, ignore_suggest_patterns, rm_cached};
use commands::index_ops::{
    add_paths, revert_lines, stage_hunks, stage_lines, stage_paths, unstage_hunks, unstage_lines,
    unstage_paths,
};
use commands::jobs::{job_cancel, job_list};
use commands::multi_root::{
    multi_root_checkout, multi_root_rollback, parse_wsl_path, repo_discover, ui_sync_broadcast,
};
use commands::patch::{patch_apply, patch_apply_clipboard, patch_create};
use commands::refs::{
    branch_checkout, branch_create, branch_delete, branch_rename, branch_restore, branch_update,
    compare_branches, favorites_toggle, refs_list, tag_create, tag_delete, tag_push,
};
use commands::remotes::{
    remote_add, remote_delete_branch, remote_edit, remote_list, remote_remove,
    remote_remove_preview,
};
use commands::rewrite::{
    cherry_pick_abort, cherry_pick_continue, cherry_pick_run, cherry_pick_skip, drop_changes,
    drop_commits, extract_changes, fixup_into, merge_abort, merge_commit, merge_run, rebase_abort,
    rebase_continue, rebase_interactive_plan, rebase_interactive_start, rebase_run, rebase_skip,
    repo_op_state_get, reset_preview, reset_run, revert_abort, revert_continue, revert_run,
    reword_commit, squash_commits, uncommit, undo_rewrite,
};
use commands::shelf::{
    shelf_create, shelf_delete, shelf_import, shelf_list, shelf_list_deleted, shelf_rename,
    shelf_restore, shelf_unshelve,
};
use commands::stash::{
    stash_apply, stash_branch, stash_clear, stash_create, stash_drop, stash_list, stash_pop,
    stash_restore,
};
use commands::status::status_get;
use commands::sync::{
    fetch_run, ls_remote_check, pull_run, push_preview, push_run, submodule_update, sync_fork,
    update_project_run,
};
use commands::workspace::{init_run, status_probe, vcs_enable, workspace_open, workspace_recent};
use commands::worktree::{
    worktree_add, worktree_default_path, worktree_list, worktree_lock, worktree_open_ref,
    worktree_prune, worktree_prune_preview, worktree_remove, worktree_unlock,
};
use gitx_meta::load_app_settings;
use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,gitx=debug")),
        )
        .init();

    let specta_builder =
        tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
            app_info,
            git_detect,
            git_test_executable,
            settings_get,
            settings_set,
            settings_reload,
            log_frontend,
            job_list,
            job_cancel,
            workspace_open,
            workspace_recent,
            status_probe,
            init_run,
            vcs_enable,
            status_get,
            stage_paths,
            unstage_paths,
            add_paths,
            stage_hunks,
            unstage_hunks,
            diff_file,
            diff_file_at,
            diff_refs,
            diff_combined,
            commit_create,
            commit_head_message,
            log_query,
            log_locate,
            log_commit_details,
            log_changed_files,
            // M3
            file_history,
            blame_file,
            tree_list,
            blob_read,
            checkout_path_from_rev,
            list_refs,
            log_index_status,
            log_index_rebuild,
            // M2
            refs_list,
            favorites_toggle,
            branch_create,
            branch_checkout,
            branch_rename,
            branch_delete,
            branch_restore,
            branch_update,
            compare_branches,
            tag_create,
            tag_delete,
            tag_push,
            remote_list,
            remote_add,
            remote_edit,
            remote_remove_preview,
            remote_remove,
            remote_delete_branch,
            fetch_run,
            pull_run,
            update_project_run,
            push_preview,
            push_run,
            ls_remote_check,
            clone_check_url,
            clone_run,
            unshallow_run,
            repo_state_get,
            // M4
            repo_op_state_get,
            merge_run,
            merge_abort,
            merge_commit,
            rebase_run,
            rebase_continue,
            rebase_skip,
            rebase_abort,
            cherry_pick_run,
            cherry_pick_continue,
            cherry_pick_skip,
            cherry_pick_abort,
            conflicts_list,
            conflict_accept_side,
            conflict_versions,
            conflict_merge3,
            conflict_save_result,
            conflict_mark_resolved,
            conflict_resolve_simple,
            // M5
            rebase_interactive_plan,
            rebase_interactive_start,
            reword_commit,
            squash_commits,
            drop_commits,
            fixup_into,
            uncommit,
            revert_run,
            revert_continue,
            revert_abort,
            reset_preview,
            reset_run,
            undo_rewrite,
            extract_changes,
            drop_changes,
            // M6
            stage_lines,
            unstage_lines,
            revert_lines,
            changelist_list,
            changelist_create,
            changelist_rename,
            changelist_delete,
            changelist_set_active,
            changelist_move,
            stash_list,
            stash_create,
            stash_apply,
            stash_pop,
            stash_drop,
            stash_clear,
            stash_branch,
            stash_restore,
            shelf_list,
            shelf_list_deleted,
            shelf_create,
            shelf_unshelve,
            shelf_delete,
            shelf_restore,
            shelf_rename,
            shelf_import,
            ignore_add,
            ignore_suggest_patterns,
            exclude_open,
            rm_cached,
            patch_create,
            patch_apply,
            patch_apply_clipboard,
            // M7
            worktree_list,
            worktree_add,
            worktree_remove,
            worktree_lock,
            worktree_unlock,
            worktree_prune_preview,
            worktree_prune,
            worktree_open_ref,
            worktree_default_path,
            repo_discover,
            multi_root_checkout,
            multi_root_rollback,
            ui_sync_broadcast,
            parse_wsl_path,
            sync_fork,
            submodule_update,
            credential_session_set,
            credential_session_clear,
        ]);

    #[cfg(debug_assertions)]
    specta_builder
        .export(
            specta_typescript::Typescript::default()
                .header("// This file was generated by `tauri-specta`. Do not edit.\n"),
            "../apps/desktop/src/lib/backend/bindings.ts",
        )
        .expect("failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            specta_builder.mount_events(app);

            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("gitx"));
            let settings_path = config_dir.join("settings.json");
            let settings = load_app_settings(&settings_path).unwrap_or_default();
            app.manage(AppState::new(settings_path, settings));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running gitx");
}
