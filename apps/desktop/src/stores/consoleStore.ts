import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type ConsoleEntry = {
  id: string;
  stream: "cmd" | "stdout" | "stderr";
  line: string;
  at: number;
};

const MAX = 5000;

export const useConsoleStore = defineStore("console", () => {
  // Output can arrive while this panel is hidden. Keep ingestion constant-time
  // instead of moving thousands of reactive array slots for every new entry.
  const entries = Array.from<ConsoleEntry | undefined>({ length: MAX });
  let first = 0;
  let size = 0;
  const revision = ref(0);
  const lines = computed(() => {
    // Materialize chronological output only when a consumer reads the history.
    // Vue batches the panel's watcher, so a burst shares one snapshot.
    void revision.value;
    return Array.from({ length: size }, (_, i) => entries[(first + i) % MAX]!);
  });

  function append(stream: ConsoleEntry["stream"], line: string) {
    entries[(first + size) % MAX] = {
      id: crypto.randomUUID(),
      stream,
      line,
      at: Date.now(),
    };
    if (size === MAX) first = (first + 1) % MAX;
    else size++;
    revision.value++;
  }

  function clear() {
    entries.fill(undefined);
    first = 0;
    size = 0;
    revision.value++;
    // Release a previously read cached snapshot even when the panel is hidden.
    void lines.value;
  }

  return { lines, append, clear };
});
