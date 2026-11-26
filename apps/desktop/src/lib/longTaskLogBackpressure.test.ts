import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(), logFrontend: vi.fn() }));
vi.mock("@/lib/utils", () => ({ isTauri: mocks.isTauri }));
vi.mock("@/lib/backend/bindings", () => ({ commands: { logFrontend: mocks.logFrontend } }));

let release: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  mocks.isTauri.mockReset().mockReturnValue(true);
  mocks.logFrontend.mockReset().mockResolvedValue(null);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(async () => {
  release?.();
  release = undefined;
  await settleImports();
  vi.restoreAllMocks();
});

async function settleImports() {
  await vi.dynamicImportSettled();
  await flushPromises();
}

function stallNativeLog() {
  const pending = new Promise<null>((resolve) => {
    release = () => resolve(null);
  });
  mocks.logFrontend.mockReturnValue(pending);
}

it("bounds native calls while a log sink is stalled and preserves every console entry", async () => {
  stallNativeLog();
  const { perfLog } = await import("./longTaskLog");
  for (let i = 0; i < 1000; i++) perfLog("warn", `sample ${i}`);
  await settleImports();
  expect(mocks.logFrontend).toHaveBeenCalledTimes(1);
  for (let i = 1000; i < 2000; i++) perfLog("warn", `sample ${i}`);
  await settleImports();
  expect(mocks.logFrontend).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledTimes(2000);
  expect(console.warn).toHaveBeenLastCalledWith("[gitx:perf] sample 1999");
});

it("resumes forwarding after completion without replaying a stale backlog", async () => {
  stallNativeLog();
  const { perfLog } = await import("./longTaskLog");
  perfLog("info", "first");
  await settleImports();
  perfLog("debug", "busy");
  release?.();
  await settleImports();
  expect(mocks.logFrontend).toHaveBeenCalledTimes(1);
  mocks.logFrontend.mockResolvedValue(null);
  perfLog("warn", "resumed");
  await settleImports();
  expect(mocks.logFrontend).toHaveBeenCalledTimes(2);
  expect(mocks.logFrontend).toHaveBeenLastCalledWith("warn", "[gitx:perf] resumed");
  expect(console.debug).toHaveBeenCalledWith("[gitx:perf] busy");
});

it("allows subsequent diagnostics after a rejected native log", async () => {
  mocks.logFrontend.mockRejectedValueOnce(new Error("sink unavailable"));
  const { perfLog } = await import("./longTaskLog");
  perfLog("warn", "failed");
  await settleImports();
  perfLog("info", "retry");
  await settleImports();
  expect(mocks.logFrontend).toHaveBeenCalledTimes(2);
  expect(mocks.logFrontend).toHaveBeenLastCalledWith("info", "[gitx:perf] retry");
});

it("keeps browser diagnostics local", async () => {
  mocks.isTauri.mockReturnValue(false);
  const { perfLog } = await import("./longTaskLog");
  perfLog("info", "browser");
  await settleImports();
  expect(mocks.logFrontend).not.toHaveBeenCalled();
  expect(console.info).toHaveBeenCalledWith("[gitx:perf] browser");
});
