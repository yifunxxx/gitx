import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getBackend } from "@/lib/backend";

export type JobUi = {
  id: string;
  title: string;
  percent?: number;
  message?: string;
  startedAt: number;
};

export const useJobsStore = defineStore("jobs", () => {
  const running = ref<JobUi[]>([]);
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

  async function refresh(current: () => boolean = () => true) {
    if (refreshing) return;
    refreshing = true;
    const version = eventVersion;
    try {
      const jobs = await getBackend().jobList();
      // Events received during the read are more recent than its snapshot.
      if (!current() || version !== eventVersion) return;
      running.value = jobs.map((job) => ({
        id: job.id,
        title: job.title,
        startedAt: job.startedAt,
      }));
    } finally {
      refreshing = false;
    }
  }

  return { running, count, started, progress, finished, refresh };
});
