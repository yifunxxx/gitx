import { defineStore } from "pinia";
import { ref } from "vue";

export type ConsoleEntry = {
  id: string;
  stream: "cmd" | "stdout" | "stderr";
  line: string;
  at: number;
};

const MAX = 5000;

export const useConsoleStore = defineStore("console", () => {
  const lines = ref<ConsoleEntry[]>([]);

  function append(stream: ConsoleEntry["stream"], line: string) {
    lines.value.push({
      id: crypto.randomUUID(),
      stream,
      line,
      at: Date.now(),
    });
    if (lines.value.length > MAX) {
      lines.value.splice(0, lines.value.length - MAX);
    }
  }

  function clear() {
    lines.value = [];
  }

  return { lines, append, clear };
});
