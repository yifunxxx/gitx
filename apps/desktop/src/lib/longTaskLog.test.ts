import { afterEach, expect, it, vi } from "vitest";
import { isPerfLogEnabled, PERF_LOG_KEY, timedSync } from "./longTaskLog";

afterEach(() => {
  localStorage.removeItem(PERF_LOG_KEY);
  vi.restoreAllMocks();
});

it("reads the gitx.perfLog opt-in flag", () => {
  expect(isPerfLogEnabled()).toBe(false);
  localStorage.setItem(PERF_LOG_KEY, "1");
  expect(isPerfLogEnabled()).toBe(true);
});

it("times sync work and returns the value", () => {
  const spy = vi.spyOn(console, "info").mockImplementation(() => {});
  localStorage.setItem(PERF_LOG_KEY, "1");
  expect(timedSync("unit.sample", () => 42, 0)).toBe(42);
  expect(spy.mock.calls.some((call) => String(call[0]).includes("unit.sample"))).toBe(true);
});
