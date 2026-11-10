import { onMounted, onUnmounted, watch } from "vue";
import { getBackend } from "@/lib/backend";
import { isTauri } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore } from "@/stores/changesStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { useLogStore } from "@/stores/logStore";
import { useDiffStore } from "@/stores/diffStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useConflictsStore } from "@/stores/conflictsStore";
import { useWorktreesStore } from "@/stores/worktreesStore";
import { useStashShelfStore } from "@/stores/stashShelfStore";
import { useJobsStore } from "@/stores/jobsStore";
import { useConsoleStore } from "@/stores/consoleStore";
import { formatErrorMessage } from "@/lib/errors";

type ChangeKind = "worktree" | "index" | "refs" | "opState" | "ignore" | "metadata";
type ChangedEvent = {
  repoId: string;
  kinds: ChangeKind[];
  watchGeneration?: number;
  degraded?: boolean;
};
const allKinds: ChangeKind[] = ["worktree", "index", "refs", "opState", "ignore", "metadata"];
// Monotonic across component remounts; timestamps also survive module reloads.
let lastRegistration = Date.now();

/** One refresh at a time. Bursts are coalesced and events received during a
 * refresh cause one subsequent pass, with no overlapping polling requests. */
export function useRepositoryRefresh() {
  const ws = useWorkspaceStore();
  const changes = useChangesStore();
  const branches = useBranchesStore();
  const log = useLogStore();
  const diffs = useDiffStore();
  const rewrite = useRewriteStore();
  const conflicts = useConflictsStore();
  const worktrees = useWorktreesStore();
  const stash = useStashShelfStore();
  const jobs = useJobsStore();
  const console = useConsoleStore();
  const pending = new Set<ChangeKind>();
  let disposed = false;
  let ready = false;
  let running: number | null = null;
  let fallback = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let unlisten: (() => void) | undefined;
  let generation = 0;
  let nativeGeneration: number | undefined;
  let logPending = false;
  let configureChain = Promise.resolve();

  function schedule(kinds: ChangeKind[]) {
    if (disposed || !ws.isRepo || !ws.repoPath) return;
    for (const kind of kinds) pending.add(kind);
    if (running === null && !timer && document.visibilityState !== "hidden")
      timer = setTimeout(() => void flush(), 200);
  }

  async function flush() {
    timer = undefined;
    if (
      disposed ||
      (!pending.size && !logPending) ||
      !ws.isRepo ||
      document.visibilityState === "hidden"
    )
      return;
    // Wait for gitx writes to finish, then publish their final state.
    if (jobs.count || rewrite.busy) {
      timer = setTimeout(() => void flush(), 300);
      return;
    }
    const kinds = new Set(pending);
    pending.clear();
    const version = generation;
    const path = ws.repoPath;
    const current = () => !disposed && version === generation && path === ws.repoPath;
    running = version;
    const tasks: Promise<unknown>[] = [];
    const run = (task: () => unknown) =>
      tasks.push(Promise.resolve().then(() => (current() ? task() : undefined)));
    if (kinds.size) run(() => changes.refresh(true));
    if (kinds.has("refs")) {
      run(() => branches.refresh());
      run(() => worktrees.refresh());
      run(() => stash.refresh());
      logPending = true;
    } else if (kinds.has("metadata")) {
      run(() => stash.refresh());
    }
    if (logPending && !log.loading && !log.locating && !log.loadingMore && !log.loadingPrevious) {
      logPending = false;
      run(() => {
        if (log.loading || log.locating || log.loadingMore || log.loadingPrevious)
          logPending = true;
        else return log.load(true, true);
      });
    }
    if (kinds.has("opState") || kinds.has("index") || kinds.has("refs")) {
      run(() => rewrite.refreshOpState());
      run(() => conflicts.refresh());
    }
    for (const tab of diffs.tabs) {
      if (kinds.size && tab.kind === "file") run(() => diffs.reloadTab(tab.id, { soft: true }));
    }
    const results = await Promise.allSettled(tasks);
    if (current()) {
      const error = results.find((result) => result.status === "rejected");
      if (error?.status === "rejected") console.append("stderr", formatErrorMessage(error.reason));
    }
    if (running === version) running = null;
    if (current() && (pending.size || logPending)) schedule([]);
  }

  function configure() {
    const version = ++generation;
    pending.clear();
    logPending = false;
    running = null;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (disposed) return;
    if (!ready) {
      if (fallback) schedule(allKinds);
      return;
    }
    const roots = ws.isRepo ? ws.roots.map((root) => ({ ...root })) : [];
    const registration = (lastRegistration = Math.max(lastRegistration + 1, Date.now()));
    nativeGeneration = registration;
    // Serialize registration so a slower old workspace cannot win the race.
    configureChain = configureChain.then(async () => {
      if (disposed || version !== generation) return;
      try {
        // A runtime failure event can arrive before this IPC acknowledgement.
        // Only starting a new registration may clear the previous fallback.
        fallback = false;
        await getBackend().workspaceWatch(roots, registration);
      } catch (error) {
        if (version === generation && !disposed) {
          fallback = true;
          console.append("stderr", `${formatErrorMessage(error)}; using periodic refresh`);
        }
      }
      // Also covers changes that happened while registering the native watch.
      if (!disposed && version === generation) schedule(allKinds);
    });
  }

  function onFocus() {
    if (document.visibilityState !== "hidden") schedule(allKinds);
  }

  watch(() => [ws.repoPath, ws.isRepo, ws.roots] as const, configure, { flush: "sync" });
  onMounted(async () => {
    if (!isTauri()) return;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      if (disposed) return;
      const cleanup = await listen<ChangedEvent>("repo://changed", ({ payload }) => {
        if (payload.watchGeneration !== undefined && payload.watchGeneration !== nativeGeneration)
          return;
        if (payload.degraded) fallback = true;
        if (payload.repoId === ws.repoId) schedule(payload.kinds);
      });
      if (disposed) {
        cleanup();
        return;
      }
      unlisten = cleanup;
      ready = true;
      configure();
    } catch (error) {
      if (disposed) return;
      fallback = true;
      console.append("stderr", formatErrorMessage(error));
      schedule(allKinds);
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    poll = setInterval(() => {
      if (fallback && document.visibilityState !== "hidden") schedule(allKinds);
    }, 5000);
  });
  onUnmounted(() => {
    disposed = true;
    ++generation;
    pending.clear();
    if (timer) clearTimeout(timer);
    if (poll) clearInterval(poll);
    unlisten?.();
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onFocus);
    if (nativeGeneration !== undefined) {
      // Backend releases only this registration or an older one, never a newer mount.
      void getBackend()
        .workspaceUnwatch(nativeGeneration)
        .catch(() => {});
    }
  });
}
