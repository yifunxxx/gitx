import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend, type AppUpdateInfo } from "@/lib/backend";
import { toast } from "@/composables/useToast";
import { formatErrorMessage } from "@/lib/errors";
import { i18n } from "@/i18n";
import { isTauri } from "@/lib/utils";

const DISMISSED_KEY = "gitx.update.dismissedVersion";
const LAST_CHECK_KEY = "gitx.update.lastCheckAt";
const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 8_000;

export const useUpdateStore = defineStore("update", () => {
  const currentVersion = ref<string | null>(null);
  const latest = ref<AppUpdateInfo | null>(null);
  const checking = ref(false);
  const error = ref<string | null>(null);
  const lastCheckedAt = ref<number | null>(readLastCheck());
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  let periodTimer: ReturnType<typeof setInterval> | undefined;
  let started = false;

  function readDismissed(): string | null {
    try {
      return localStorage.getItem(DISMISSED_KEY);
    } catch {
      return null;
    }
  }

  function readLastCheck(): number | null {
    try {
      const raw = localStorage.getItem(LAST_CHECK_KEY);
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  function rememberCheck(at = Date.now()) {
    lastCheckedAt.value = at;
    try {
      localStorage.setItem(LAST_CHECK_KEY, String(at));
    } catch {
      /* ignore quota / private mode */
    }
  }

  function dismissLatest() {
    const version = latest.value?.latestVersion;
    if (!version) return;
    try {
      localStorage.setItem(DISMISSED_KEY, version);
    } catch {
      /* ignore */
    }
  }

  async function ensureCurrentVersion() {
    if (currentVersion.value) return currentVersion.value;
    const info = await getBackend().appInfo();
    currentVersion.value = info.version;
    return info.version;
  }

  async function openReleasePage(url?: string | null) {
    const target = url || latest.value?.releaseUrl || "https://github.com/yifunxxx/gitx/releases";
    if (isTauri()) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(target);
      return;
    }
    window.open(target, "_blank", "noopener,noreferrer");
  }

  async function checkForUpdates(opts: { manual?: boolean; quiet?: boolean } = {}) {
    if (checking.value) return latest.value;
    checking.value = true;
    error.value = null;
    try {
      await ensureCurrentVersion();
      const info = await getBackend().appCheckForUpdates();
      latest.value = info;
      rememberCheck();
      if (info.newer && opts.manual !== false) {
        const dismissed = readDismissed();
        const shouldNotify = opts.manual || dismissed !== info.latestVersion;
        if (shouldNotify && !opts.quiet) {
          toast({
            title: String(
              i18n.global.t("updates.availableTitle", { version: info.latestVersion }),
            ),
            description: String(
              i18n.global.t("updates.availableBody", { current: info.currentVersion }),
            ),
            persistent: true,
            action: {
              label: String(i18n.global.t("updates.openRelease")),
              onClick: () => {
                dismissLatest();
                void openReleasePage(info.releaseUrl);
              },
            },
          });
        }
      } else if (opts.manual && !info.newer) {
        toast({
          title: String(i18n.global.t("updates.upToDateTitle")),
          description: String(
            i18n.global.t("updates.upToDateBody", { version: info.currentVersion }),
          ),
        });
      }
      return info;
    } catch (reason) {
      const message = formatErrorMessage(reason);
      error.value = message;
      if (opts.manual) {
        toast({
          title: String(i18n.global.t("updates.checkFailed")),
          description: message,
        });
      }
      throw reason;
    } finally {
      checking.value = false;
    }
  }

  function startAutoChecks() {
    if (started) return;
    started = true;
    const due =
      lastCheckedAt.value == null || Date.now() - lastCheckedAt.value >= AUTO_INTERVAL_MS;
    if (due) {
      autoTimer = setTimeout(() => {
        void checkForUpdates({ quiet: false }).catch(() => {});
      }, STARTUP_DELAY_MS);
    }
    periodTimer = setInterval(
      () => {
        void checkForUpdates({ quiet: false }).catch(() => {});
      },
      AUTO_INTERVAL_MS,
    );
  }

  function stopAutoChecks() {
    if (autoTimer) clearTimeout(autoTimer);
    if (periodTimer) clearInterval(periodTimer);
    autoTimer = undefined;
    periodTimer = undefined;
    started = false;
  }

  return {
    currentVersion,
    latest,
    checking,
    error,
    lastCheckedAt,
    ensureCurrentVersion,
    checkForUpdates,
    openReleasePage,
    dismissLatest,
    startAutoChecks,
    stopAutoChecks,
  };
});
