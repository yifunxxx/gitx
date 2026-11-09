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
type ChangedEvent = { repoId: string; kinds: ChangeKind[] };
const allKinds: ChangeKind[] = ["worktree", "index", "refs", "opState", "ignore", "metadata"];

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
  let running = false;
  let fallback = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  let unlisten: (() => void) | undefined;
  let generation = 0;
  let configureChain = Promise.resolve();

  function schedule(kinds: ChangeKind[]) {
    if (disposed || !ws.isRepo || !ws.repoPath) return;
    for (const kind of kinds) pending.add(kind);
    if (!running && !timer) timer = setTimeout(() => void flush(), 200);
  }

  async function flush() {
    timer = undefined;
    if (disposed || !pending.size || !ws.isRepo) return;
    // Wait for gitx writes to finish, then publish their final state.
    if (jobs.count || rewrite.busy) {
      timer = setTimeout(() => void flush(), 300);
      return;
    }
    const kinds = new Set(pending);
    pending.clear();
    running = true;
    const tasks: Promise<unknown>[] = [changes.refresh(true)];
    if (kinds.has("refs")) {
      tasks.push(branches.refresh(), log.load(true, true), worktrees.refresh(), stash.refresh());
    } else if (kinds.has("metadata")) {
      tasks.push(stash.refresh());
    }
    if (kinds.has("opState") || kinds.has("index") || kinds.has("refs")) {
      tasks.push(rewrite.refreshOpState(), conflicts.refresh());
    }
    for (const tab of diffs.tabs) {
      if (tab.kind === "file") tasks.push(diffs.reloadTab(tab.id, { soft: true }));
    }
    const results = await Promise.allSettled(tasks);
    if (!disposed) {
      const error = results.find((result) => result.status === "rejected");
      if (error?.status === "rejected") console.append("stderr", formatErrorMessage(error.reason));
    }
    running = false;
    if (!disposed && pending.size) schedule([]);
  }

  function configure() {
    const version = ++generation;
    pending.clear();
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!ready || disposed) return;
    // Serialize registration so a slower old workspace cannot win the race.
    configureChain = configureChain.then(async () => {
      if (disposed || version !== generation) return;
      try {
        await getBackend().workspaceWatch(ws.isRepo ? [...ws.roots] : []);
        if (version === generation) fallback = false;
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

  watch(() => [ws.repoPath, ws.isRepo, ws.roots] as const, configure, { flush: "post" });
  onMounted(async () => {
    if (!isTauri()) return;
    const { listen } = await import("@tauri-apps/api/event");
    if (disposed) return;
    try {
      const cleanup = await listen<ChangedEvent>("repo://changed", ({ payload }) => {
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
    // The native session is replaced on the next mount and released on window
    // destruction. No late cleanup command can clear a newly mounted session.
  });
}
