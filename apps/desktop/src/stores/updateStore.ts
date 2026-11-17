import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { getBackend, type AppUpdateInfo } from "@/lib/backend";
import { toast } from "@/composables/useToast";
import { openDialog } from "@/composables/useDialog";
import { formatErrorMessage } from "@/lib/errors";
import { i18n } from "@/i18n";
import { isTauri } from "@/lib/utils";
import UpdateCenterDialog from "@/features/updates/UpdateCenterDialog.vue";

const IGNORED_KEY = "gitx.update.dismissedVersion";
const LAST_CHECK_KEY = "gitx.update.lastCheckAt";
const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 8_000;

export type UpdatePhase = "idle" | "available" | "downloading" | "ready" | "installing" | "error";

export const useUpdateStore = defineStore("update", () => {
  const currentVersion = ref<string | null>(null);
  const latest = ref<AppUpdateInfo | null>(null);
  const checking = ref(false);
  const error = ref<string | null>(null);
  const lastCheckedAt = ref<number | null>(readLastCheck());
  const phase = ref<UpdatePhase>("idle");
  const downloadProgress = ref<number | null>(null);
  const downloadedPath = ref<string | null>(null);
  const downloadedVersion = ref<string | null>(null);
  const ignoredVersion = ref<string | null>(readIgnored());
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  let periodTimer: ReturnType<typeof setInterval> | undefined;
  let started = false;
  let downloadToken = 0;
  let unlistenProgress: (() => void) | undefined;
  let centerOpen = false;

  const updateAvailable = computed(() => {
    const info = latest.value;
    if (!info?.newer) return false;
    return info.latestVersion !== ignoredVersion.value;
  });

  const statusText = computed(() => {
    const version = latest.value?.latestVersion;
    if (!version || !updateAvailable.value) return "";
    if (phase.value === "downloading") {
      const pct = downloadProgress.value;
      return pct == null
        ? String(i18n.global.t("updates.statusDownloading", { version }))
        : String(i18n.global.t("updates.statusDownloadingPct", { version, pct }));
    }
    if (phase.value === "ready" || phase.value === "installing") {
      return String(i18n.global.t("updates.statusReady", { version }));
    }
    if (phase.value === "error") {
      return error.value || String(i18n.global.t("updates.downloadFailed"));
    }
    return String(i18n.global.t("updates.statusAvailable", { version }));
  });

  const toolbarTooltip = computed(() => statusText.value || String(i18n.global.t("updates.openCenter")));

  const primaryActionLabel = computed(() => {
    if (phase.value === "ready" || phase.value === "installing") {
      return String(i18n.global.t("updates.restartAndUpdate"));
    }
    if (phase.value === "downloading") {
      return String(i18n.global.t("updates.downloading"));
    }
    return String(i18n.global.t("updates.downloadAndInstall"));
  });

  function readIgnored(): string | null {
    try {
      return localStorage.getItem(IGNORED_KEY);
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

  function ignoreThisVersion() {
    const version = latest.value?.latestVersion;
    if (!version) return;
    ignoredVersion.value = version;
    try {
      localStorage.setItem(IGNORED_KEY, version);
    } catch {
      /* ignore */
    }
    downloadToken += 1;
    if (phase.value === "downloading" || phase.value === "available") {
      phase.value = "idle";
      downloadProgress.value = null;
    }
    if (downloadedVersion.value === version) {
      downloadedPath.value = null;
      downloadedVersion.value = null;
    }
  }

  /** @deprecated use ignoreThisVersion */
  function dismissLatest() {
    ignoreThisVersion();
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

  async function openDownloadPage() {
    await openReleasePage(latest.value?.releaseUrl);
  }

  async function openUpdateCenter() {
    if (centerOpen) return;
    centerOpen = true;
    try {
      await openDialog(UpdateCenterDialog);
    } finally {
      centerOpen = false;
    }
  }

  async function ensureProgressListener() {
    if (!isTauri() || unlistenProgress) return;
    const { listen } = await import("@tauri-apps/api/event");
    unlistenProgress = await listen<{
      version: string;
      downloaded: number;
      total: number | null;
    }>("update://progress", (event) => {
      const payload = event.payload;
      if (!latest.value || payload.version !== latest.value.latestVersion) return;
      if (payload.total && payload.total > 0) {
        downloadProgress.value = Math.min(
          99,
          Math.round((payload.downloaded / payload.total) * 100),
        );
      }
    });
  }

  function preferredInstallerUrl(info: AppUpdateInfo = latest.value!): string | null {
    return info.nsisUrl || info.msiUrl || null;
  }

  async function downloadUpdate(opts: { installAfter?: boolean } = {}) {
    const info = latest.value;
    if (!info?.newer) return null;
    const url = preferredInstallerUrl(info);
    if (!url) {
      error.value = String(i18n.global.t("updates.noInstaller"));
      phase.value = "error";
      throw new Error(error.value);
    }
    if (
      downloadedPath.value &&
      downloadedVersion.value === info.latestVersion &&
      phase.value === "ready"
    ) {
      if (opts.installAfter) await installUpdate();
      return downloadedPath.value;
    }
    const token = ++downloadToken;
    phase.value = "downloading";
    downloadProgress.value = null;
    error.value = null;
    await ensureProgressListener();
    try {
      const result = await getBackend().appDownloadUpdate({
        url,
        version: info.latestVersion,
      });
      if (token !== downloadToken) return null;
      downloadedPath.value = result.path;
      downloadedVersion.value = result.version;
      downloadProgress.value = 100;
      phase.value = "ready";
      if (opts.installAfter) await installUpdate();
      return result.path;
    } catch (reason) {
      if (token !== downloadToken) return null;
      const message = formatErrorMessage(reason);
      error.value = message;
      phase.value = "error";
      throw reason;
    }
  }

  async function installUpdate() {
    const info = latest.value;
    if (!info?.newer) return;
    let path = downloadedPath.value;
    if (!path || downloadedVersion.value !== info.latestVersion) {
      path = await downloadUpdate();
    }
    if (!path) return;
    phase.value = "installing";
    try {
      await getBackend().appInstallUpdate({ path });
      // On Windows the process exits; elsewhere surface a clear message.
      toast({
        title: String(i18n.global.t("updates.installStartedTitle")),
        description: String(i18n.global.t("updates.installStartedBody")),
      });
      phase.value = "ready";
    } catch (reason) {
      const message = formatErrorMessage(reason);
      error.value = message;
      phase.value = "error";
      toast({
        title: String(i18n.global.t("updates.installFailed")),
        description: message,
      });
      throw reason;
    }
  }

  async function primaryAction() {
    if (phase.value === "ready" || phase.value === "installing") {
      await installUpdate();
      return;
    }
    await downloadUpdate({ installAfter: true });
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
      const ignored = ignoredVersion.value;
      const relevant = info.newer && info.latestVersion !== ignored;
      if (relevant) {
        if (
          downloadedVersion.value === info.latestVersion &&
          downloadedPath.value &&
          phase.value !== "installing"
        ) {
          phase.value = "ready";
        } else if (phase.value !== "downloading" && phase.value !== "ready") {
          phase.value = "available";
        }
        const shouldNotify = opts.manual || ignored !== info.latestVersion;
        if (shouldNotify && !opts.quiet && opts.manual !== false) {
          // Quiet auto path: show toolbar only; manual keeps a toast that opens the center.
          if (opts.manual) {
            toast({
              title: String(
                i18n.global.t("updates.availableTitle", { version: info.latestVersion }),
              ),
              description: String(
                i18n.global.t("updates.availableBody", { current: info.currentVersion }),
              ),
              persistent: true,
              action: {
                label: String(i18n.global.t("updates.openCenter")),
                onClick: () => {
                  void openUpdateCenter();
                },
              },
            });
          }
        }
        if (!opts.manual) {
          void downloadUpdate().catch(() => {});
        }
      } else if (!info.newer) {
        phase.value = "idle";
        downloadProgress.value = null;
        if (opts.manual) {
          toast({
            title: String(i18n.global.t("updates.upToDateTitle")),
            description: String(
              i18n.global.t("updates.upToDateBody", { version: info.currentVersion }),
            ),
          });
        }
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
    // Always quiet-check ~8s after each launch (docs/in-app-update-check.md).
    // Do not gate on lastCheckedAt — that skipped startup checks for a full day
    // after any prior success, so relaunches looked like auto-check was broken.
    autoTimer = setTimeout(() => {
      void checkForUpdates({ quiet: true }).catch(() => {});
    }, STARTUP_DELAY_MS);
    periodTimer = setInterval(
      () => {
        void checkForUpdates({ quiet: true }).catch(() => {});
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
    downloadToken += 1;
    unlistenProgress?.();
    unlistenProgress = undefined;
  }

  return {
    currentVersion,
    latest,
    checking,
    error,
    lastCheckedAt,
    phase,
    downloadProgress,
    downloadedPath,
    ignoredVersion,
    updateAvailable,
    statusText,
    toolbarTooltip,
    primaryActionLabel,
    ensureCurrentVersion,
    checkForUpdates,
    openReleasePage,
    openDownloadPage,
    openUpdateCenter,
    downloadUpdate,
    installUpdate,
    primaryAction,
    ignoreThisVersion,
    dismissLatest,
    startAutoChecks,
    stopAutoChecks,
  };
});
