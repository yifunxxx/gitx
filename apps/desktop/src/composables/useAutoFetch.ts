import { computed, onMounted, onUnmounted, watch } from "vue";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { useJobsStore } from "@/stores/jobsStore";
import { useConsoleStore } from "@/stores/consoleStore";
import { formatErrorMessage, invokeErrorCode } from "@/lib/errors";
import { isAuthError } from "@/lib/auth";
import { toast } from "./useToast";
import { i18n } from "@/i18n";

/** One timer for the active repository; missed intervals never form a backlog. */
export function useAutoFetch() {
  const ws = useWorkspaceStore();
  const settings = useSettingsStore();
  const branches = useBranchesStore();
  const jobs = useJobsStore();
  const console = useConsoleStore();
  const interval = computed(() => {
    const value = settings.settings?.git?.autoFetchMinutes;
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.min(1440, Math.max(1, Math.floor(value))) * 60_000
      : 0;
  });
  let mounted = false;
  let generation = 0;
  let dueAt = 0;
  let inFlight = false;
  let failures = 0;
  let notified = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  function ready() {
    return (
      mounted &&
      interval.value > 0 &&
      ws.isRepo &&
      !!ws.repoPath &&
      branches.remotes.length > 0 &&
      !inFlight &&
      !branches.fetching &&
      !jobs.count &&
      document.visibilityState !== "hidden" &&
      navigator.onLine !== false
    );
  }
  function schedule() {
    clearTimer();
    if (ready()) timer = setTimeout(() => void run(), Math.max(0, dueAt - Date.now()));
  }
  function reset() {
    ++generation;
    failures = 0;
    notified = false;
    dueAt = Date.now() + interval.value;
    schedule();
  }
  async function run() {
    timer = undefined;
    if (!ready()) return;
    const epoch = generation;
    const path = ws.repoPath!;
    const current = () => mounted && epoch === generation;
    inFlight = true;
    try {
      const result = await branches.fetch(undefined, { background: true, current });
      if (current() && result) {
        failures = 0;
        notified = false;
      }
    } catch (error) {
      if (!current() || invokeErrorCode(error)?.toLowerCase() === "cancelled") return;
      ++failures;
      console.append(
        "stderr",
        `${i18n.global.t("operations.autoFetch")} · ${path}: ${formatErrorMessage(error)}`,
      );
      // Auth needs explicit interaction. Other failures get one notice after
      // three attempts; keep retrying at the configured cadence, without dialogs.
      if (!notified && (isAuthError(error) || failures >= 3)) {
        notified = true;
        toast({
          title: i18n.global.t(
            isAuthError(error) ? "branches.autoFetchAuth" : "branches.autoFetchFailed",
          ),
          description: path,
          action: {
            label: i18n.global.t("branches.fetchNow"),
            disabled: () => !current() || branches.fetching,
            onClick: () => {
              if (!current() || branches.fetching) return false;
              void branches.fetch().catch(() => {
                /* Manual fetch reports errors. */
              });
            },
          },
        });
      }
    } finally {
      inFlight = false;
      if (current()) dueAt = Date.now() + interval.value;
      schedule();
    }
  }
  watch(
    [() => ws.repoPath, () => ws.repoId, () => ws.isRepo, () => ws.navigationToken(), interval],
    reset,
    { flush: "sync" },
  );
  watch([() => jobs.count, () => branches.fetching, () => branches.remotes.length], schedule);
  watch(
    () => branches.lastFetchAt,
    (value) => {
      if (value === null) return;
      failures = 0;
      notified = false;
      dueAt = Date.now() + interval.value;
      schedule();
    },
  );
  onMounted(() => {
    mounted = true;
    reset();
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("online", schedule);
    window.addEventListener("offline", schedule);
  });
  onUnmounted(() => {
    mounted = false;
    ++generation;
    clearTimer();
    document.removeEventListener("visibilitychange", schedule);
    window.removeEventListener("online", schedule);
    window.removeEventListener("offline", schedule);
  });
}
