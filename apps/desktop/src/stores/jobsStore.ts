import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getBackend } from "@/lib/backend";

export type JobUi = {
  id: string;
  title: string;
  percent?: number;
  message?: string;
  startedAt: number;
  cancellable?: boolean;
};

export const useJobsStore = defineStore("jobs", () => {
  const running = ref<JobUi[]>([]);
  const popupOpen = ref(false);
  const anchorX = ref(8);
  const anchorY = ref(0);
  let eventVersion = 0;
  let refreshing = false;

  const count = computed(() => running.value.length);

  function started(job: Omit<JobUi, "startedAt"> & { startedAt?: number }) {
    ++eventVersion;
    running.value = [
      ...running.value.filter((j) => j.id !== job.id),
      { ...job, startedAt: job.startedAt ?? Date.now() },
    ];
  }

  function progress(id: string, patch: Partial<JobUi>) {
    running.value = running.value.map((j) => (j.id === id ? { ...j, ...patch } : j));
  }

  function finished(id: string) {
    ++eventVersion;
    running.value = running.value.filter((j) => j.id !== id);
  }

  function openPopup(anchor?: { x: number; y: number }) {
    if (anchor) {
      anchorX.value = anchor.x;
      anchorY.value = anchor.y;
    }
    popupOpen.value = true;
    void refresh().catch(() => {
      /* StatusBar list can still show event-driven rows. */
    });
  }

  function closePopup() {
    popupOpen.value = false;
  }

  async function cancel(id: string) {
    const ok = await getBackend().jobCancel(id);
    if (ok) finished(id);
    return ok;
  }

  async function refresh(current: () => boolean = () => true) {
    if (refreshing) return;
    refreshing = true;
    const version = eventVersion;
    try {
      const jobs = await getBackend().jobList();
      // Events received during the read are more recent than its snapshot.
      if (!current() || version !== eventVersion) return;
      const prevById = new Map(running.value.map((job) => [job.id, job]));
      running.value = jobs.map((job) => {
        const prev = prevById.get(job.id);
        return {
          id: job.id,
          title: job.title,
          startedAt: job.startedAt,
          cancellable: job.cancellable,
          percent: prev?.percent,
          message: prev?.message,
        };
      });
    } finally {
      refreshing = false;
    }
  }

  return {
    running,
    count,
    popupOpen,
    anchorX,
    anchorY,
    started,
    progress,
    finished,
    openPopup,
    closePopup,
    cancel,
    refresh,
  };
});
