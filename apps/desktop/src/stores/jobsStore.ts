import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type JobUi = {
  id: string;
  title: string;
  percent?: number;
  message?: string;
};

export const useJobsStore = defineStore("jobs", () => {
  const running = ref<JobUi[]>([]);

  const count = computed(() => running.value.length);

  function started(job: JobUi) {
    running.value = [...running.value.filter((j) => j.id !== job.id), job];
  }

  function progress(id: string, patch: Partial<JobUi>) {
    running.value = running.value.map((j) => (j.id === id ? { ...j, ...patch } : j));
  }

  function finished(id: string) {
    running.value = running.value.filter((j) => j.id !== id);
  }

  return { running, count, started, progress, finished };
});
