//! Hide console windows when spawning CLI tools from the GUI on Windows.

/// `CREATE_NO_WINDOW` — prevents cascading empty console flashes ("空终端").
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[inline]
pub fn hide_console_std(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}

#[inline]
pub fn hide_console_tokio(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}
