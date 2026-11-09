use std::collections::HashSet;

/// Keep the most recent spelling of each path, without probing disk or network.
pub fn deduplicate_recent_workspaces(paths: &mut Vec<String>) {
    let mut seen = HashSet::new();
    paths.retain(|path| seen.insert(gitx_core::host_path_key(path)));
    paths.truncate(20);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_recent_order_and_limits_the_unique_list() {
        let mut paths = vec!["/repo/a".into(), "/repo/b".into(), "/repo/a/".into()];
        deduplicate_recent_workspaces(&mut paths);
        assert_eq!(paths, ["/repo/a", "/repo/b"]);
        paths.extend((0..30).map(|i| format!("/repo/{i}")));
        deduplicate_recent_workspaces(&mut paths);
        assert_eq!(paths.len(), 20);
        assert_eq!(paths[0], "/repo/a");
    }

    #[test]
    #[cfg(windows)]
    fn windows_spellings_share_one_entry_but_linux_case_is_preserved() {
        let mut paths = vec![
            "E:/Repo/Test".into(),
            r"e:\repo\test\".into(),
            r"\\?\E:\Repo\Test".into(),
            r"\\server\share\repo".into(),
            r"\\?\UNC\server\share\repo".into(),
            r"\\wsl$\Ubuntu\home\Repo".into(),
            r"\\?\UNC\WSL.LOCALHOST\ubuntu\home\Repo".into(),
            r"\\wsl$\Ubuntu\home\repo".into(),
        ];
        deduplicate_recent_workspaces(&mut paths);
        assert_eq!(paths.len(), 4);
        assert_eq!(paths[0], "E:/Repo/Test");
    }
}
