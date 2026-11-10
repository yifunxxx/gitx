/** Observe main-thread long tasks (helps diagnose scroll freezes in desktop builds). */
export function installLongTaskLogging() {
  if (typeof PerformanceObserver === "undefined") return () => {};
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 50) continue;
        console.warn(
          `[gitx] long-task ${Math.round(entry.duration)}ms @ ${Math.round(entry.startTime)}ms`,
        );
      }
    });
    observer.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
    return () => observer.disconnect();
  } catch {
    return () => {};
  }
}
