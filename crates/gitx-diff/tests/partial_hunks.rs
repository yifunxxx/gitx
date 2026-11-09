use gitx_diff::{
    apply_selected_hunks_to_base, apply_unstage_hunks_to_index, compute_hunks, DiffComputeOptions,
};

#[test]
fn hunk_staging_preserves_crlf_and_trailing_blank_lines() {
    let base = "before\r\nold\r\nafter\r\n\r\n";
    let work = "before\r\nnew\r\nafter\r\n\r\n";
    assert_eq!(apply_selected_hunks_to_base(base, work, &[0]), work);
    assert_eq!(apply_unstage_hunks_to_index(base, work, &[0]), base);
}

#[test]
fn selected_final_newline_removal_is_not_undone_by_reconstruction() {
    assert_eq!(apply_selected_hunks_to_base("old\n", "new", &[0]), "new");
    assert_eq!(apply_unstage_hunks_to_index("old", "new\n", &[0]), "old");
}

#[test]
fn empty_or_unknown_selection_never_normalizes_original_bytes() {
    for selected in [vec![], vec![999]] {
        let base = "before\r\nold\r\n\r\n";
        let work = "before\r\nnew\r\n\r\n";
        assert_eq!(apply_selected_hunks_to_base(base, work, &selected), base);
        assert_eq!(apply_unstage_hunks_to_index(base, work, &selected), work);
    }
}

#[test]
fn unselected_eof_change_stays_out_of_earlier_hunk() {
    let base = (1..=40).map(|i| format!("line {i}\n")).collect::<String>();
    let work = base
        .replacen("line 2\n", "selected\n", 1)
        .trim_end_matches('\n')
        .to_string();
    let expected = base.replacen("line 2\n", "selected\n", 1);
    assert_eq!(
        compute_hunks(Some(&base), Some(&work), &DiffComputeOptions::default()).len(),
        2
    );
    assert_eq!(apply_selected_hunks_to_base(&base, &work, &[0]), expected);
    assert_eq!(
        apply_unstage_hunks_to_index(&base, &work, &[0]),
        base.trim_end_matches('\n')
    );
}

#[test]
fn hunk_context_keeps_its_original_line_endings() {
    let base = "before\r\nold\r\nafter\r\n";
    let work = "before\nnew\nafter\n";
    assert_eq!(
        apply_selected_hunks_to_base(base, work, &[0]),
        "before\r\nnew\nafter\r\n"
    );
    assert_eq!(
        apply_unstage_hunks_to_index(base, work, &[0]),
        "before\nold\r\nafter\n"
    );
}

#[test]
fn all_hunk_subsets_handle_insert_delete_replace_and_eof_without_offsets() {
    for ending in ["\n", "\r\n", "\r"] {
        for eof in [false, true] {
            let base = (1..=60)
                .map(|i| format!("line {i}{}", if i < 60 || eof { ending } else { "" }))
                .collect::<String>();
            let compose = |mask: u32| {
                let mut result = String::new();
                if mask & 1 != 0 {
                    result.push_str(&format!("early{ending}"));
                }
                for i in 1..=60 {
                    if i == 20 && mask & 2 != 0 {
                        continue;
                    }
                    let text = if i == 40 && mask & 4 != 0 {
                        "中文 replacement".to_string()
                    } else {
                        format!("line {i}")
                    };
                    result.push_str(&text);
                    if i < 60 || eof {
                        result.push_str(ending);
                    }
                }
                if mask & 8 != 0 {
                    if !eof {
                        result.push_str(ending);
                    }
                    result.push_str("last");
                    if eof {
                        result.push_str(ending);
                    }
                }
                result
            };
            let work = compose(15);
            assert_eq!(
                compute_hunks(Some(&base), Some(&work), &DiffComputeOptions::default()).len(),
                4
            );
            for mask in 0..16 {
                let selected = (0..4).filter(|i| mask & (1 << i) != 0).collect::<Vec<_>>();
                assert_eq!(
                    apply_selected_hunks_to_base(&base, &work, &selected),
                    compose(mask),
                    "stage {ending:?} {eof} {mask}"
                );
                assert_eq!(
                    apply_unstage_hunks_to_index(&base, &work, &selected),
                    compose(15 ^ mask),
                    "unstage {ending:?} {eof} {mask}"
                );
            }
        }
    }
}

#[test]
fn whole_additions_and_deletions_preserve_exact_bytes() {
    for text in ["", "\r\n", "\n\n", "+literal\r-tail\r\r", "first\r\nlast"] {
        assert_eq!(apply_selected_hunks_to_base("", text, &[0]), text);
        assert_eq!(apply_unstage_hunks_to_index("", text, &[0]), "");
        assert_eq!(apply_selected_hunks_to_base(text, "", &[0]), "");
        assert_eq!(apply_unstage_hunks_to_index(text, "", &[0]), text);
    }
}
