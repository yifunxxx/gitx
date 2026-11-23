import { beforeEach, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useConsoleStore } from "./consoleStore";

beforeEach(() => setActivePinia(createPinia()));

it("retains the last 5000 entries in order after multiple full-capacity cycles", () => {
  const store = useConsoleStore();
  for (let i = 0; i < 15003; i++) store.append(i % 2 ? "stderr" : "stdout", `line ${i}`);
  expect(store.lines).toHaveLength(5000);
  expect(store.lines.map((entry) => entry.line)).toEqual(
    Array.from({ length: 5000 }, (_, i) => `line ${10003 + i}`),
  );
  expect(new Set(store.lines.map((entry) => entry.id)).size).toBe(5000);
  expect(store.lines[0]?.stream).toBe("stderr");
  expect(store.lines.at(-1)?.stream).toBe("stdout");
  expect(store.lines.every((entry) => Number.isFinite(entry.at))).toBe(true);
}, 120000);

it("clears a wrapped history and starts the next history without stale entries", () => {
  const store = useConsoleStore();
  for (let i = 0; i < 5003; i++) store.append("cmd", `git command ${i}`);
  store.clear();
  expect(store.lines).toEqual([]);
  store.append("stderr", "first error\nsecond error");
  expect(store.lines.map(({ stream, line }) => ({ stream, line }))).toEqual([
    { stream: "stderr", line: "first error\nsecond error" },
  ]);
  store.clear();
  store.clear();
  store.append("stdout", "");
  expect(store.lines).toHaveLength(1);
  expect(store.lines[0]?.line).toBe("");
});
