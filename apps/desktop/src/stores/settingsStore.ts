import { defineStore } from "pinia";
import { ref } from "vue";
import type { AppSettings } from "@/lib/backend";
import { getBackend } from "@/lib/backend";

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings | null>(null);

  async function load() {
    settings.value = await getBackend().settingsGet();
    applyAppearance();
  }

  async function save(next: AppSettings) {
    settings.value = await getBackend().settingsSet(next);
    applyAppearance();
  }

  function applyAppearance() {
    const appearance = settings.value?.appearance;
    if (!appearance) return;
    const root = document.documentElement;
    const theme = appearance.theme;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = theme === "dark" || (theme === "system" && prefersDark);
    root.classList.toggle("dark", dark);
    root.dataset.cornerStyle = appearance.cornerStyle || "small";
    root.dataset.palette = appearance.palette || "pearl";
  }

  return { settings, load, save, applyAppearance };
});
