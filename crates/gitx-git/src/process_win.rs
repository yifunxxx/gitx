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

// PSS descriptors and walk markers have their own release functions; they are
// not kernel handles and must not be wrapped in OwnedHandle/CloseHandle.
#[cfg(windows)]
mod thread_snapshot {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use windows_sys::Win32::Foundation::{ERROR_NO_MORE_ITEMS, ERROR_SUCCESS, HANDLE};
    use windows_sys::Win32::System::{Diagnostics::ProcessSnapshotting::*, Threading::*};

    struct Snapshot(HPSS);

    impl Drop for Snapshot {
        fn drop(&mut self) {
            // The descriptor was allocated in this process, even though the
            // captured threads belong to the child.
            unsafe { PssFreeSnapshot(GetCurrentProcess(), self.0) };
        }
    }

    struct WalkMarker(HPSSWALK);

    impl Drop for WalkMarker {
        fn drop(&mut self) {
            unsafe { PssWalkMarkerFree(self.0) };
        }
    }

    fn check(result: u32) -> std::io::Result<()> {
        if result == ERROR_SUCCESS {
            Ok(())
        } else {
            // PSS returns a Win32 error directly, not through GetLastError.
            Err(std::io::Error::from_raw_os_error(result as i32))
        }
    }

    pub(super) fn child_thread(process: HANDLE, pid: u32) -> std::io::Result<OwnedHandle> {
        unsafe {
            let mut raw = std::ptr::null_mut();
            // Capture only this child's thread IDs. A ToolHelp thread snapshot
            // enumerates the whole machine for every Git command.
            check(PssCaptureSnapshot(
                process,
                PSS_CAPTURE_THREADS,
                0,
                &mut raw,
            ))?;
            let snapshot = Snapshot(raw);
            let mut raw_marker = std::ptr::null_mut();
            check(PssWalkMarkerCreate(std::ptr::null(), &mut raw_marker))?;
            let marker = WalkMarker(raw_marker);
            let mut entry: PSS_THREAD_ENTRY = std::mem::zeroed();
            loop {
                let result = PssWalkSnapshot(
                    snapshot.0,
                    PSS_WALK_THREADS,
                    marker.0,
                    (&mut entry as *mut PSS_THREAD_ENTRY).cast(),
                    std::mem::size_of_val(&entry) as u32,
                );
                if result == ERROR_NO_MORE_ITEMS {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "suspended child thread unavailable",
                    ));
                }
                check(result)?;
                if entry.ProcessId != pid || entry.Flags & PSS_THREAD_FLAGS_TERMINATED != 0 {
                    continue;
                }
                let raw_thread = OpenThread(
                    THREAD_SUSPEND_RESUME | THREAD_QUERY_LIMITED_INFORMATION,
                    0,
                    entry.ThreadId,
                );
                if raw_thread.is_null() {
                    return Err(std::io::Error::last_os_error());
                }
                let thread = OwnedHandle::from_raw_handle(raw_thread);
                // A process may have been terminated externally after capture.
                // Never resume a reused thread ID from another process.
                let owner = GetProcessIdOfThread(thread.as_raw_handle());
                if owner == 0 {
                    return Err(std::io::Error::last_os_error());
                }
                if owner != pid {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "child thread owner changed",
                    ));
                }
                return Ok(thread);
            }
        }
    }
}

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
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::{JobObjects::*, Threading::*};
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
            let thread = thread_snapshot::child_thread(process, pid)?;
            if ResumeThread(thread.as_raw_handle()) == u32::MAX {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        }
    }

    pub fn terminate(&self) {
        use std::os::windows::io::AsRawHandle;
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0.as_raw_handle(), 1);
        }
    }
}
