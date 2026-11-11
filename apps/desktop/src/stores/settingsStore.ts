import { defineStore } from "pinia";
import { onScopeDispose, ref } from "vue";
import type { AppSettings } from "@/lib/backend";
import { getBackend } from "@/lib/backend";
import { i18n } from "@/i18n";
import { cloneJson } from "@/lib/clone";

export const useSettingsStore = defineStore("settings", () => {
  let mediaQueryUnsub: (() => void) | null = null;
  const settings = ref<AppSettings | null>(null);
  const previews = new Map<symbol, AppSettings>();
  let saveQueue: Promise<unknown> = Promise.resolve();

  function renderAppearance() {
    const source = [...previews.values()].at(-1) ?? settings.value;
    if (source) previewAppearance(source);
  }

  // A delayed save or an older dialog's cleanup must not overwrite a newer preview.
  function beginAppearancePreview(initial: AppSettings) {
    const id = Symbol("settings-preview");
    previews.set(id, cloneJson(initial));
    renderAppearance();
    return {
      update(next: AppSettings) {
        if (!previews.has(id)) return;
        previews.set(id, cloneJson(next));
        renderAppearance();
      },
      end() {
        if (previews.delete(id)) renderAppearance();
      },
    };
  }

  function emptySettings(): AppSettings {
    return {
      schemaVersion: 4,
      appearance: {
        theme: "system",
        palette: "pearl",
        cornerStyle: "small",
      },
      locale: "en",
      gitExecutable: null,
      recentWorkspaces: [],
      stagingMode: false,
      showIgnoredFiles: false,
      logIndexing: true,
      keymapOverrides: {},
      git: {
        updateMethod: "merge",
        fetchTags: "auto",
        autoFetchMinutes: 0,
        checkIncoming: "auto",
        showUpdateInfo: true,
        showOptionsBeforeUpdate: true,
        fetchOnAddRemote: true,
        protectedBranches: ["main", "master"],
        useCredentialHelper: true,
        groupBranchesByDirectory: true,
        showRecentBranches: true,
        showTags: true,
        cherryPickSuffixProtected: true,
        cleanTreeMethod: "stash",
        combineStashesAndShelves: true,
        allowPerHunkChangelists: true,
        executeBranchOpsOnAllRoots: true,
        updateSubmodules: "auto",
        forkParentRemote: "upstream",
        commitTwMode: "docked",
        commitControlsHidden: false,
        closeCommitTwAfterCommit: false,
        logListMode: "flat",
      },
    };
  }

  async function load() {
    settings.value = await getBackend().settingsGet();
    renderAppearance();
    watchSystemTheme();
  }

  function save(next: AppSettings) {
    const plain = cloneJson(next);
    const result = saveQueue.then(async () => {
      settings.value = await getBackend().settingsSet(plain);
      renderAppearance();
      return settings.value;
    });
    saveQueue = result.catch(() => {});
    return result;
  }

  function previewAppearance(next: AppSettings) {
    applyAppearance(cloneJson(next));
    applyLocale(next.locale);
  }

  function applyLocale(locale: string | undefined) {
    const resolved = locale === "en" || locale === "zh-CN" ? locale : "en";
    i18n.global.locale.value = resolved as "zh-CN" | "en";
    document.documentElement.lang = resolved;
  }

  function applyAppearance(appearanceSource: AppSettings | null | undefined) {
    const appearance = appearanceSource?.appearance;
    if (!appearance) return;
    const root = document.documentElement;
    const theme = appearance.theme;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = theme === "dark" || (theme === "system" && prefersDark);
    root.classList.toggle("dark", dark);
    root.dataset.cornerStyle = appearance.cornerStyle || "small";
    root.dataset.palette = appearance.palette || "pearl";
  }

  function watchSystemTheme() {
    mediaQueryUnsub?.();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => renderAppearance();
    mq.addEventListener("change", onChange);
    mediaQueryUnsub = () => mq.removeEventListener("change", onChange);
  }

  onScopeDispose(() => {
    mediaQueryUnsub?.();
    previews.clear();
  });

  async function setTheme(theme: "light" | "dark" | "system") {
    const base = cloneJson(settings.value ?? emptySettings());
    await save({
      ...base,
      appearance: { ...base.appearance, theme },
    });
  }

  async function toggleTheme() {
    const current = settings.value?.appearance.theme ?? "system";
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const effectivelyDark = current === "dark" || (current === "system" && prefersDark);
    await setTheme(effectivelyDark ? "light" : "dark");
  }

  async function setLocale(locale: "zh-CN" | "en") {
    const base = cloneJson(settings.value ?? emptySettings());
    await save({ ...base, locale });
  }

  return {
    settings,
    load,
    save,
    emptySettings,
    previewAppearance,
    beginAppearancePreview,
    applyAppearance,
    applyLocale,
    setTheme,
    toggleTheme,
    setLocale,
  };
});
