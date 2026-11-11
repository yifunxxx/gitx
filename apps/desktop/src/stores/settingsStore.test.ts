import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSettingsStore } from "./settingsStore";
import type { AppSettings } from "@/lib/backend";

const backend = vi.hoisted(() => ({ settingsGet: vi.fn(), settingsSet: vi.fn() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => backend }));
let store: ReturnType<typeof useSettingsStore>;
let dark: boolean;
let listeners: Set<() => void>;
beforeEach(async () => {
  vi.resetAllMocks();
  dark = false;
  listeners = new Set();
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return dark; },
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }));
  setActivePinia(createPinia());
  store = useSettingsStore();
  backend.settingsGet.mockResolvedValue(store.emptySettings());
  backend.settingsSet.mockImplementation(async (next: AppSettings) => next);
  await store.load();
});
afterEach(() => { store.$dispose(); vi.unstubAllGlobals(); });

it("honors an explicit draft theme when the system theme changes", () => {
  const preview = store.beginAppearancePreview({ ...store.emptySettings(), appearance: { theme: "light", palette: "graphite", cornerStyle: "none" } });
  dark = true;
  listeners.forEach((callback) => callback());
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  preview.end();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.dataset.palette).toBe("pearl");
});

it("follows the system for a system draft even if the saved theme is explicit", async () => {
  const next = store.emptySettings();
  next.appearance.theme = "light";
  await store.save(next);
  const preview = store.beginAppearancePreview(store.emptySettings());
  dark = true;
  listeners.forEach((callback) => callback());
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  preview.end();
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});

it("does not leak system listeners across reloads or disposal", async () => {
  await store.load();
  expect(listeners.size).toBe(1);
  store.$dispose();
  expect(listeners.size).toBe(0);
});

it("serializes saves and continues after failure without replacing committed settings", async () => {
  let reject!: (error: unknown) => void;
  backend.settingsSet.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
  const first = store.emptySettings();
  first.locale = "en";
  const later = store.emptySettings();
  later.appearance.theme = "dark";
  const failed = store.save(first).catch((error) => error);
  const saved = store.save(later);
  later.appearance.theme = "light";
  await Promise.resolve();
  expect(backend.settingsSet).toHaveBeenCalledTimes(1);
  reject(new Error("disk full"));
  expect((await failed).message).toBe("disk full");
  expect((await saved).appearance.theme).toBe("dark");
  expect(store.settings!.locale).toBe("en");
  expect(backend.settingsSet).toHaveBeenCalledTimes(2);
});

it("keeps a newer preview when an older preview is disposed", () => {
  const initial = store.emptySettings();
  initial.appearance.theme = "dark";
  const old = store.beginAppearancePreview(initial);
  const latest = store.emptySettings();
  latest.locale = "zh-CN";
  latest.appearance.theme = "light";
  const newer = store.beginAppearancePreview(latest);
  old.end();
  old.update(initial);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(document.documentElement.lang).toBe("zh-CN");
  newer.end();
  expect(document.documentElement.lang).toBe("en");
});
