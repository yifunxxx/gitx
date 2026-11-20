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

it("previews glass with system appearance and removes its surface when cancelled", () => {
  const draft = store.emptySettings();
  draft.appearance.theme = "liquid-glass";
  const preview = store.beginAppearancePreview(draft);
  expect(document.documentElement.dataset.theme).toBe("liquid-glass");
  expect(store.appearanceDark).toBe(false);
  dark = true;
  listeners.forEach(callback => callback());
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(store.appearanceDark).toBe(true);
  preview.end();
  expect(document.documentElement.dataset.theme).toBe("standard");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(backend.settingsSet).not.toHaveBeenCalled();
});

it.each(["liquid-glass-light", "liquid-glass-dark"] as const)("persists explicit %s and keeps it across system changes", async (theme) => {
  await store.setTheme(theme);
  expect(backend.settingsSet.mock.lastCall![0].appearance.theme).toBe(theme);
  dark = theme.endsWith("light");
  listeners.forEach(callback => callback());
  expect(store.appearanceDark).toBe(theme.endsWith("dark"));
  expect(document.documentElement.dataset.theme).toBe("liquid-glass");
  backend.settingsGet.mockResolvedValue(store.settings);
  await store.load();
  expect(store.settings!.appearance.theme).toBe(theme);
  expect(document.documentElement.classList.contains("dark")).toBe(theme.endsWith("dark"));
});

it("toggles glass brightness without leaving the glass theme", async () => {
  await store.setTheme("liquid-glass");
  await store.toggleTheme();
  expect(store.settings!.appearance.theme).toBe("liquid-glass-dark");
  expect(store.appearanceDark).toBe(true);
  await store.toggleTheme();
  expect(store.settings!.appearance.theme).toBe("liquid-glass-light");
  expect(store.appearanceDark).toBe(false);
  expect(document.documentElement.dataset.theme).toBe("liquid-glass");
});

it("restores applied glass after previewing standard appearance or a failed save", async () => {
  await store.setTheme("liquid-glass-dark");
  const draft = store.emptySettings();
  draft.appearance.theme = "light";
  draft.appearance.cornerStyle = "none";
  const preview = store.beginAppearancePreview(draft);
  expect(document.documentElement.dataset.theme).toBe("standard");
  backend.settingsSet.mockRejectedValueOnce(new Error("disk full"));
  await expect(store.save(draft)).rejects.toThrow("disk full");
  preview.end();
  expect(document.documentElement.dataset.theme).toBe("liquid-glass");
  expect(store.appearanceDark).toBe(true);
  expect(document.documentElement.dataset.cornerStyle).toBe("small");
});
