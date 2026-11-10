import { isTauri } from "@/lib/utils";

/** Opt-in: `localStorage.setItem("gitx.perfLog", "1")` then reload. */
export const PERF_LOG_KEY = "gitx.perfLog";

export function isPerfLogEnabled(): boolean {
  try {
    const value = localStorage.getItem(PERF_LOG_KEY);
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}

function shouldReport(ms: number, alwaysMs: number): boolean {
  return ms >= alwaysMs || isPerfLogEnabled();
}

/** Console + optional Rust `log_frontend` (shows in app / desktop logs). */
export function perfLog(level: "info" | "warn" | "debug", message: string) {
  const line = `[gitx:perf] ${message}`;
  if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.info(line);
  if (!isTauri()) return;
  void import("@/lib/backend/bindings")
    .then(({ commands }) => commands.logFrontend(level, line))
    .catch(() => {});
}

/** Sync section timer — reports when opt-in or slower than `alwaysMs` (default 50). */
export function timedSync<T>(label: string, fn: () => T, alwaysMs = 50): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    const ms = performance.now() - start;
    if (shouldReport(ms, alwaysMs)) perfLog(ms >= 50 ? "warn" : "info", `${label} ${ms.toFixed(1)}ms`);
  }
}

/** Async section timer for loadMore / IPC-bound work. */
export async function timedAsync<T>(
  label: string,
  fn: () => Promise<T>,
  alwaysMs = 50,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const ms = performance.now() - start;
    if (shouldReport(ms, alwaysMs)) perfLog(ms >= 50 ? "warn" : "info", `${label} ${ms.toFixed(1)}ms`);
  }
}

/**
 * Observe main-thread long tasks.
 * Always logs ≥50ms to the console; also mirrors to the app log when opt-in or ≥100ms.
 */
export function installLongTaskLogging() {
  if (typeof PerformanceObserver === "undefined") return () => {};
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 50) continue;
        const message = `long-task ${Math.round(entry.duration)}ms @ ${Math.round(entry.startTime)}ms`;
        console.warn(`[gitx] ${message}`);
        if (entry.duration >= 100 || isPerfLogEnabled()) perfLog("warn", message);
      }
    });
    observer.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
    if (isPerfLogEnabled()) perfLog("info", "perf log enabled (localStorage gitx.perfLog=1)");
    return () => observer.disconnect();
  } catch {
    return () => {};
  }
}
