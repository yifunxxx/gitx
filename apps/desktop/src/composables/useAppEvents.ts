import { onMounted, onUnmounted } from "vue";
import { isTauri } from "@/lib/utils";
import { useJobsStore } from "@/stores/jobsStore";
import { useConsoleStore } from "@/stores/consoleStore";
import { formatErrorMessage } from "@/lib/errors";

/** Own each subscription as soon as it resolves, including after unmount. */
export function useAppEvents() {
  const jobs = useJobsStore();
  const console = useConsoleStore();
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const cleanups: (() => void)[] = [];
  const keep = (cleanup: () => void) => (disposed ? cleanup() : cleanups.push(cleanup));
  const report = (error: unknown) => {
    if (!disposed) console.append("stderr", formatErrorMessage(error));
  };
  const onLine = (payload: { stream: string; line: string }) => {
    if (!disposed) console.append(payload.stream as "cmd" | "stdout" | "stderr", payload.line);
  };
  const refresh = () => {
    void jobs.refresh(() => !disposed).catch(report);
  };

  onMounted(async () => {
    if (!isTauri()) {
      const handler = (event: Event) => onLine((event as CustomEvent).detail);
      window.addEventListener("console://line", handler);
      keep(() => window.removeEventListener("console://line", handler));
      return;
    }
    try {
      const { listen } = await import("@tauri-apps/api/event");
      if (disposed) return;
      await Promise.allSettled([
        listen<{ stream: string; line: string }>("console://line", (e) => onLine(e.payload))
          .then(keep)
          .catch(report),
        listen<{ id: string; title?: string; cancellable?: boolean }>("job://started", (e) => {
          if (!disposed)
            jobs.started({
              id: e.payload.id,
              title: e.payload.title ?? "job",
              cancellable: e.payload.cancellable,
            });
        })
          .then(keep)
          .catch(report),
        listen<{
          id: string;
          percent?: number;
          message?: string;
          phase?: string;
        }>("job://progress", (e) => {
          if (!disposed)
            jobs.progress(e.payload.id, {
              percent: e.payload.percent,
              message: e.payload.message ?? e.payload.phase,
            });
        })
          .then(keep)
          .catch(report),
        listen<{ id: string }>("job://finished", (e) => {
          if (!disposed) jobs.finished(e.payload.id);
        })
          .then(keep)
          .catch(report),
      ]);
    } catch (error) {
      report(error);
    }
    if (disposed) return;
    refresh();
    // Reconcile missed events against actual native jobs, never an age cutoff.
    timer = setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
  });
  onUnmounted(() => {
    disposed = true;
    if (timer) clearInterval(timer);
    window.removeEventListener("focus", refresh);
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });
}
