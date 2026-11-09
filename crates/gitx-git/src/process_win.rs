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

/// Own a Windows job so grandchildren cannot survive cancellation or app exit.
#[cfg(windows)]
pub struct ProcessJob(std::os::windows::io::OwnedHandle);

#[cfg(windows)]
impl ProcessJob {
    pub fn new() -> std::io::Result<Self> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle};
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let raw = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if raw.is_null() {
                return Err(std::io::Error::last_os_error());
            }
            let job = Self(std::os::windows::io::OwnedHandle::from_raw_handle(raw));
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job.0.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            ) == 0
            {
                return Err(std::io::Error::last_os_error());
            }
            Ok(job)
        }
    }

    pub fn prepare(&self, cmd: &mut tokio::process::Command) {
        use windows_sys::Win32::System::Threading::CREATE_SUSPENDED;
        // Assign the job before the child can spawn any descendant.
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
    }

    pub fn attach_and_resume(&self, child: &tokio::process::Child) -> std::io::Result<()> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
        use windows_sys::Win32::System::{Diagnostics::ToolHelp::*, JobObjects::*, Threading::*};
        let process = child
            .raw_handle()
            .ok_or_else(|| std::io::Error::other("child process unavailable"))?;
        let pid = child
            .id()
            .ok_or_else(|| std::io::Error::other("child pid unavailable"))?;
        unsafe {
            if AssignProcessToJobObject(self.0.as_raw_handle(), process) == 0 {
                return Err(std::io::Error::last_os_error());
            }
            let raw = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
            if raw == INVALID_HANDLE_VALUE {
                return Err(std::io::Error::last_os_error());
            }
            let snapshot = OwnedHandle::from_raw_handle(raw);
            let mut thread: THREADENTRY32 = std::mem::zeroed();
            thread.dwSize = std::mem::size_of_val(&thread) as u32;
            let mut found = Thread32First(snapshot.as_raw_handle(), &mut thread);
            while found != 0 {
                if thread.th32OwnerProcessID == pid {
                    let raw = OpenThread(THREAD_SUSPEND_RESUME, 0, thread.th32ThreadID);
                    if raw.is_null() {
                        return Err(std::io::Error::last_os_error());
                    }
                    let handle = OwnedHandle::from_raw_handle(raw);
                    if ResumeThread(handle.as_raw_handle()) == u32::MAX {
                        return Err(std::io::Error::last_os_error());
                    }
                    return Ok(());
                }
                found = Thread32Next(snapshot.as_raw_handle(), &mut thread);
            }
            Err(std::io::Error::other("suspended child thread unavailable"))
        }
    }

    pub fn terminate(&self) {
        use std::os::windows::io::AsRawHandle;
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0.as_raw_handle(), 1);
        }
    }
}
