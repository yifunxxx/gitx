import { defineStore, getActivePinia } from "pinia";
import { computed, onScopeDispose, ref } from "vue";
import { getBackend } from "@/lib/backend";
import { observeBackendActivity } from "@/lib/backend/activity";
import { i18n } from "@/i18n";
import { formatErrorMessage } from "@/lib/errors";

export type JobUi = {
  id: string;
  title: string;
  percent?: number;
  message?: string;
  startedAt: number;
  cancellable?: boolean;
  cancelling?: boolean;
};

export type JobStartSource = "ui" | "native";

export const useJobsStore = defineStore("jobs", () => {
  const running = ref<JobUi[]>([]);
  const popupOpen = ref(false);
  const anchorX = ref(8);
  const anchorY = ref(0);
  /** IDs observed via native JobManager (jobList / job://started). */
  let knownNativeIds = new Set<string>();
  let eventVersion = 0;
  const refreshing = ref(false);
  const refreshError = ref("");
  let nextUiId = 0;
  const cancellations = new Map<string, object>();
  let disposed = false;

  const stopObserving = observeBackendActivity(getActivePinia()!, (operation) => {
    const label = i18n.global.t(operation.titleKey);
    const id = begin(operation.target ? `${label} · ${operation.target}` : label, operation.path);
    return () => finished(id);
  });
  onScopeDispose(() => {
    disposed = true;
    cancellations.clear();
    stopObserving();
  });

  const count = computed(() => running.value.length);

  function begin(title: string, message?: string) {
    const id = `ui-operation-${++nextUiId}`;
    started({ id, title, message, cancellable: false });
    return id;
  }

  function started(
    job: Omit<JobUi, "startedAt"> & { startedAt?: number },
    source: JobStartSource = "ui",
  ) {
    ++eventVersion;
    const previous = running.value.find((entry) => entry.id === job.id);
    if (source === "native") knownNativeIds.add(job.id);
    running.value = [
      ...running.value.filter((j) => j.id !== job.id),
      { ...job, startedAt: job.startedAt ?? Date.now(), cancelling: previous?.cancelling },
    ];
  }

  function progress(id: string, patch: Partial<JobUi>) {
    running.value = running.value.map((j) => (j.id === id ? { ...j, ...patch } : j));
  }

  function finished(id: string) {
    ++eventVersion;
    cancellations.delete(id);
    knownNativeIds.delete(id);
    running.value = running.value.filter((j) => j.id !== id);
  }

  function openPopup(anchor?: { x: number; y: number }) {
    if (anchor) {
      anchorX.value = anchor.x;
      anchorY.value = anchor.y;
    }
    popupOpen.value = true;
    void refresh().catch(() => {
      /* The popup exposes refreshError while retaining event-driven rows. */
    });
  }

  function closePopup() {
    popupOpen.value = false;
  }

  async function cancel(id: string) {
    const job = running.value.find((entry) => entry.id === id);
    if (disposed || !job?.cancellable || job.cancelling) return false;
    const request = {};
    cancellations.set(id, request);
    ++eventVersion;
    progress(id, { cancelling: true });
    const current = () => !disposed && cancellations.get(id) === request;
    const reset = () => {
      cancellations.delete(id);
      ++eventVersion;
      progress(id, { cancelling: false });
    };
    try {
      const ok = await getBackend().jobCancel(id);
      if (!current()) return false;
      // Acceptance only signals the token. Retain the row and its busy state
      // until job://finished or a fresh native list confirms actual completion.
      if (!ok) reset();
      return ok;
    } catch (error) {
      if (!current()) return false;
      reset();
      throw error;
    }
  }

  async function refresh(current: () => boolean = () => true) {
    if (disposed || !current() || refreshing.value) return;
    refreshing.value = true;
    const version = eventVersion;
    try {
      const jobs = await getBackend().jobList();
      // Events received during the read are more recent than its snapshot.
      if (disposed || !current() || version !== eventVersion) return;
      refreshError.value = "";
      const prevById = new Map(running.value.map((job) => [job.id, job]));
      const listedIds = new Set(jobs.map((job) => job.id));
      const previouslyNative = knownNativeIds;
      for (const id of previouslyNative) {
        if (!listedIds.has(id)) cancellations.delete(id);
      }
      // Frontend-only jobs (pull/fetch/update-project) are never in jobList;
      // keep them so the badge and popup stay in sync while work runs.
      const uiOnly = running.value.filter(
        (job) => !listedIds.has(job.id) && !previouslyNative.has(job.id),
      );
      knownNativeIds = listedIds;
      running.value = [
        ...jobs.map((job) => {
          const prev = prevById.get(job.id);
          return {
            id: job.id,
            title: job.title,
            startedAt: job.startedAt,
            cancellable: job.cancellable,
            percent: prev?.percent,
            message: prev?.message,
            cancelling: prev?.cancelling,
          };
        }),
        ...uiOnly,
      ];
    } catch (error) {
      if (disposed || !current()) return;
      refreshError.value = formatErrorMessage(error);
      throw error;
    } finally {
      refreshing.value = false;
    }
  }

  return {
    running,
    count,
    popupOpen,
    anchorX,
    anchorY,
    refreshing,
    refreshError,
    started,
    begin,
    progress,
    finished,
    openPopup,
    closePopup,
    cancel,
    refresh,
  };
});
