import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type JobUi = {
  id: string;
  title: string;
  percent?: number;
  message?: string;
  startedAt: number;
};

const STUCK_MS = 5 * 60 * 1000;

export const useJobsStore = defineStore("jobs", () => {
  const running = ref<JobUi[]>([]);

  const count = computed(() => running.value.length);

  function started(job: Omit<JobUi, "startedAt"> & { startedAt?: number }) {
    running.value = [
      ...running.value.filter((j) => j.id !== job.id),
      { ...job, startedAt: job.startedAt ?? Date.now() },
    ];
  }

  function progress(id: string, patch: Partial<JobUi>) {
    running.value = running.value.map((j) => (j.id === id ? { ...j, ...patch } : j));
  }

  function finished(id: string) {
    running.value = running.value.filter((j) => j.id !== id);
  }

  /** Drop jobs that never received finished (defensive against stuck Busy). */
  function pruneStuck(now = Date.now()) {
    const before = running.value.length;
    running.value = running.value.filter((j) => now - j.startedAt < STUCK_MS);
    return before - running.value.length;
  }

  return { running, count, started, progress, finished, pruneStuck };
});
