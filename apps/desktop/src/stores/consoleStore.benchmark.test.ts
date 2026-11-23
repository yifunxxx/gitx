import { expect, it } from "vitest";
import { createPinia, setActivePinia, disposePinia } from "pinia";
import { useConsoleStore } from "./consoleStore";

it("measures full-capacity console ingestion with output checks", () => {
  const results: {
    mode: string;
    round: number;
    milliseconds: number;
    first: string;
    last: string;
  }[] = [];
  for (const mode of ["hidden", "read-per-burst"]) {
    for (let round = 0; round < 3; round++) {
      const pinia = createPinia();
      setActivePinia(pinia);
      const store = useConsoleStore();
      for (let i = 0; i < 5000; i++) store.append("stdout", `line ${i}`);
      expect(store.lines).toHaveLength(5000);
      const start = performance.now();
      for (let i = 5000; i < 5300; i++) {
        store.append("stdout", `line ${i}`);
        if (mode === "read-per-burst" && i % 30 === 29) {
          expect(store.lines[0]?.line).toBe(`line ${i - 4999}`);
          expect(store.lines.at(-1)?.line).toBe(`line ${i}`);
        }
      }
      const milliseconds = performance.now() - start;
      expect(store.lines).toHaveLength(5000);
      const first = store.lines[0]!.line;
      const last = store.lines.at(-1)!.line;
      expect(first).toBe("line 300");
      expect(last).toBe("line 5299");
      results.push({ mode, round, milliseconds, first, last });
      disposePinia(pinia);
    }
  }
  console.info("QA072_BENCHMARK " + JSON.stringify(results));
}, 120000);
