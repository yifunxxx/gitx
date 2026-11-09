use gitx_diff::{apply_selected_lines_to_base, revert_selected_lines_to_base};

#[test]
fn selected_replacement_does_not_keep_the_replaced_old_line() {
    assert_eq!(
        apply_selected_lines_to_base("a\nold1\nold2\nz\n", "a\nnew1\nnew2\nz\n", &[2]),
        "a\nnew1\nold2\nz\n"
    );
}

#[test]
fn selecting_a_replacement_does_not_stage_a_separate_deletion_in_the_same_hunk() {
    assert_eq!(
        apply_selected_lines_to_base("remove\nkeep\nold\n", "keep\nnew\n", &[2]),
        "remove\nkeep\nnew\n"
    );
}

#[test]
fn earlier_insertions_do_not_shift_later_partial_edits() {
    let base: Vec<String> = (1..=40).map(|i| format!("line {i}\n")).collect();
    let mut work = base.clone();
    work.insert(0, "early\n".into());
    work[25] = "selected\n".into();
    work[27] = "unselected\n".into();
    let mut expected = base.clone();
    expected[24] = "selected\n".into();
    expected.insert(0, "early\n".into());
    assert_eq!(
        apply_selected_lines_to_base(&base.concat(), &work.concat(), &[1, 26]),
        expected.concat()
    );
}

#[test]
fn crlf_and_trailing_empty_lines_are_preserved_byte_for_byte() {
    let work = "a\r\nnew\r\nz\r\n\r\n";
    assert_eq!(
        apply_selected_lines_to_base("a\r\nold\r\nz\r\n\r\n", work, &[2]),
        work
    );
}

#[test]
fn an_unselected_final_newline_change_does_not_leak_into_the_index() {
    assert_eq!(
        apply_selected_lines_to_base("a\nold\nz", "a\nnew\nz\n", &[2]),
        "a\nnew\nz"
    );
}

#[test]
fn no_selection_or_unchanged_lines_leave_the_original_bytes_alone() {
    for selection in [vec![], vec![1], vec![100], vec![0]] {
        assert_eq!(
            apply_selected_lines_to_base("a\r\nold", "a\r\nnew", &selection),
            "a\r\nold"
        );
    }
}

#[test]
fn new_file_selection_preserves_the_selected_line_ending() {
    assert_eq!(
        apply_selected_lines_to_base("", "first\r\nlast", &[2]),
        "last"
    );
    assert_eq!(
        apply_selected_lines_to_base("", "first\r\nlast", &[1]),
        "first\r\n"
    );
}

#[test]
fn every_replacement_subset_preserves_unselected_lines_and_reverts_symmetrically() {
    for ending in ["\n", "\r\n", "\r"] {
        for eof in [false, true] {
            let base: Vec<_> = (1..=4)
                .map(|i| format!("old {i}中文{}", if i < 4 || eof { ending } else { "" }))
                .collect();
            let work: Vec<_> = (1..=4)
                .map(|i| format!("new {i}中文{}", if i < 4 || eof { ending } else { "" }))
                .collect();
            for mask in 0..16 {
                let selected: Vec<u32> = (1..=4).filter(|i| mask & (1 << (i - 1)) != 0).collect();
                let staged: String = (0..4)
                    .map(|i| {
                        if selected.contains(&(i as u32 + 1)) {
                            work[i].as_str()
                        } else {
                            base[i].as_str()
                        }
                    })
                    .collect();
                let reverted: String = (0..4)
                    .map(|i| {
                        if selected.contains(&(i as u32 + 1)) {
                            base[i].as_str()
                        } else {
                            work[i].as_str()
                        }
                    })
                    .collect();
                assert_eq!(
                    apply_selected_lines_to_base(&base.concat(), &work.concat(), &selected),
                    staged
                );
                assert_eq!(
                    revert_selected_lines_to_base(&base.concat(), &work.concat(), &selected),
                    reverted
                );
            }
        }
    }
}

#[test]
fn unequal_replacement_blocks_keep_unselected_old_lines() {
    assert_eq!(
        apply_selected_lines_to_base("a\nb\nc\n", "x\ny\n", &[1]),
        "x\nb\nc\n"
    );
    assert_eq!(
        apply_selected_lines_to_base("a\nb\nc\n", "x\ny\n", &[1, 2]),
        "x\ny\n"
    );
    assert_eq!(
        revert_selected_lines_to_base("a\nb\nc\n", "x\ny\n", &[1]),
        "a\ny\n"
    );
    assert_eq!(
        revert_selected_lines_to_base("a\nb\nc\n", "x\ny\n", &[1, 2]),
        "a\nb\nc\n"
    );
    assert_eq!(
        apply_selected_lines_to_base("a\nb", "x\ny\nz\n", &[3]),
        "a\nb\nz\n"
    );
}
