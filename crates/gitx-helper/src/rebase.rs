use gitx_core::{RebasePlan, RebaseTodoAction};
use serde::Deserialize;
use std::{env, fs, io, path::Path};

#[derive(Deserialize)]
struct EditorPlan {
    #[serde(flatten)]
    plan: RebasePlan,
    #[serde(default, rename = "originalMessages")]
    originals: std::collections::HashMap<String, String>,
}

fn read_plan(path: &Path) -> io::Result<RebasePlan> {
    serde_json::from_slice(&fs::read(path)?).map_err(io::Error::other)
}

pub fn edit_todo(file: &Path) -> io::Result<()> {
    let todo = env::var("GITX_REBASE_TODO").map_err(io::Error::other)?;
    if let Ok(source) = env::var("GITX_REBASE_PLAN") {
        let plan = read_plan(Path::new(&source))?;
        let contents = if plan.rebase_merges || plan.autosquash {
            apply_to_generated_todo(&fs::read_to_string(file)?, &plan)?
        } else {
            fs::read_to_string(todo)?
        };
        // Git removes this directory on completion/abort. Keep the mapping with
        // the sequencer, surviving process exit, Edit, conflicts and Skip.
        fs::copy(source, file.with_file_name("gitx-plan.json"))?;
        fs::write(file, contents)
    } else {
        super::copy_file(&todo, &file.to_string_lossy())
    }
}

// Preserve Git's label/reset/merge topology and autosquash ordering. A flat
// replacement todo would silently discard both even with their flags enabled.
fn apply_to_generated_todo(todo: &str, plan: &RebasePlan) -> io::Result<String> {
    let mut result = String::new();
    for line in todo.lines() {
        let words: Vec<_> = line.split_whitespace().collect();
        let command = words.first().copied().unwrap_or("");
        let is_merge = command == "merge";
        let sha = if is_merge && matches!(words.get(1), Some(&"-C" | &"-c")) {
            words.get(2)
        } else if matches!(
            command,
            "pick" | "reword" | "edit" | "squash" | "fixup" | "drop"
        ) {
            words.get(1)
        } else {
            None
        };
        let item = sha.and_then(|sha| plan.items.iter().find(|item| item.sha.starts_with(*sha)));
        let changed = if let Some(item) = item {
            use RebaseTodoAction::*;
            if is_merge {
                match item.action {
                    Pick => line.to_string(),
                    Reword => line.replacen("merge -C ", "merge -c ", 1),
                    Edit => format!("{line}\nbreak"),
                    Drop => String::new(),
                    Squash | Fixup => {
                        return Err(io::Error::other("cannot squash/fixup a merge commit"))
                    }
                }
            } else {
                let verb = match item.action {
                    Pick if item.message.is_some() => "reword",
                    // Keep Git's autosquash choice for unedited pick items.
                    Pick => command,
                    Reword => "reword",
                    Edit => "edit",
                    Squash => "squash",
                    Fixup => "fixup",
                    Drop => "drop",
                };
                if verb == command {
                    line.to_string()
                } else {
                    format!(
                        "{verb} {} {}",
                        item.sha,
                        item.subject.replace(['\r', '\n'], " ")
                    )
                }
            }
        } else {
            line.to_string()
        };
        result.push_str(&changed);
        result.push('\n');
    }
    Ok(result)
}

pub fn edit_message(file: &Path) -> io::Result<()> {
    let parent = file
        .parent()
        .ok_or_else(|| io::Error::other("editor path has no parent"))?;
    let sequencer = parent.join("rebase-merge");
    let marker = sequencer.join("gitx-plan.json");
    match fs::read(&marker) {
        Ok(bytes) => {
            let saved: EditorPlan = serde_json::from_slice(&bytes).map_err(io::Error::other)?;
            let plan = &saved.plan;
            let done = fs::read_to_string(sequencer.join("done"))?;
            let commands: Vec<Vec<&str>> = done
                .lines()
                .filter(|line| !line.trim().is_empty() && !line.trim_start().starts_with('#'))
                .map(|line| line.split_whitespace().collect())
                .collect();
            let words = commands.last().map(Vec::as_slice).unwrap_or(&[]);
            if matches!(words.first().copied(), Some("squash" | "s" | "fixup" | "f")) {
                let group: Vec<_> = commands
                    .iter()
                    .rev()
                    .take_while(|words| {
                        matches!(words.first().copied(), Some("squash" | "s" | "fixup" | "f"))
                    })
                    .collect();
                let mut combined: Option<String> = None;
                for words in group.into_iter().rev() {
                    if !matches!(words.first().copied(), Some("squash" | "s")) {
                        continue;
                    }
                    let item = words
                        .get(1)
                        .and_then(|sha| plan.items.iter().find(|item| item.sha.starts_with(*sha)));
                    if let Some(item) = item {
                        if let Some(message) = &item.message {
                            combined = Some(message.clone());
                        } else if let Some(message) = &mut combined {
                            let original = saved.originals.get(&item.sha).ok_or_else(|| {
                                io::Error::other("missing original squash message")
                            })?;
                            *message = format!("{}\n\n{}", message.trim_end(), original.trim_end());
                        }
                    }
                }
                if let Some(message) = combined {
                    fs::write(file, message)?;
                }
                return Ok(());
            }
            let sha = match words.first().copied() {
                Some("reword" | "r") => words.get(1),
                Some("merge" | "m") if matches!(words.get(1), Some(&"-c")) => words.get(2),
                _ => None,
            };
            if let Some(message) = sha
                .and_then(|sha| plan.items.iter().find(|item| item.sha.starts_with(*sha)))
                .and_then(|item| item.message.as_ref())
            {
                fs::write(file, message)?;
            }
            // No override: retain Git's complete prepared message, including
            // bodies and user edits made while stopped at an Edit instruction.
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if let Ok(source) = env::var("GITX_COMMIT_MSG") {
                super::copy_file(&source, &file.to_string_lossy())?;
            }
            Ok(())
        }
        Err(error) => Err(error),
    }
}
