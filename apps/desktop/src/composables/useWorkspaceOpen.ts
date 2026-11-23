import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore } from "@/stores/changesStore";
import { useLogStore } from "@/stores/logStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { useJobsStore } from "@/stores/jobsStore";
import { isTauri } from "@/lib/utils";
import { toast } from "@/composables/useToast";
import { promptDialog } from "@/composables/useConfirm";
import { formatErrorMessage } from "@/lib/errors";
import { isWorkspaceOpening as hasOpenOperation, workspaceOpenState } from "./workspaceOpenState";

// Action enabled predicates read only the existing state. They must not create
// controllers or initialize unrelated stores while rendering menus.
export function isWorkspaceOpening() {
  return hasOpenOperation(useWorkspaceStore());
}

// Actions run outside component setup and supply the global translator; the
// component wrapper below retains the local i18n scope.
export function createWorkspaceOpen(t: (key: string) => string) {
  const workspace = useWorkspaceStore();
  const { operation, error } = workspaceOpenState(workspace);
  // Navigation from another entry retires this operation immediately; the old
  // backend read may still be pending, but must not lock the new workspace.
  const pending = computed(() => operation.value?.navigation === workspace.navigationToken());
  const pendingPath = computed(() => (pending.value ? (operation.value?.path ?? null) : null));
  const changes = useChangesStore();
  const log = useLogStore();
  const layout = useLayoutStore();
  const branches = useBranchesStore();
  const jobs = useJobsStore();

  async function pickDirectory(): Promise<string | null> {
    if (isTauri()) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      return typeof selected === "string" ? selected : null;
    }
    return promptDialog({
      title: t("welcome.openFolder"),
      defaultValue: workspace.folderPath ?? "",
      placeholder: t("welcome.folderPrompt"),
      allowEmpty: false,
    });
  }

  async function open(
    kind: "recent" | "folder" | "create" | "enable" | "clone",
    initialPath?: string,
  ) {
    if (pending.value) return;
    const id = Symbol("workspace open");
    let navigation = workspace.navigationToken();
    operation.value = { id, navigation, path: initialPath ?? null };
    error.value = null;
    const current = () => operation.value?.id === id && navigation === workspace.navigationToken();
    let opened = false;
    let loadingJob: string | null = null;
    try {
      const path = initialPath ?? (await pickDirectory());
      // A title-bar or shortcut navigation can finish while the picker is open.
      if (!path || !current()) return;
      operation.value = { id, navigation, path };
      const opening =
        kind === "enable"
          ? workspace.enableVcs("main")
          : kind === "create"
            ? workspace.initRepo(path, "main")
            : workspace.openFolder(path);
      navigation = workspace.navigationToken();
      operation.value = { id, navigation, path };
      await opening;
      if (!current()) return;
      opened = true;
      if (kind !== "recent" && kind !== "clone") {
        toast({
          title: t(
            kind === "create" || kind === "enable" ? "welcome.repoCreated" : "welcome.opened",
          ),
          description: path,
        });
      }
      layout.leftOpen = true;
      layout.bottomOpen = true;
      layout.activeBottomTab = "log";
      if (workspace.isRepo) {
        // The backend opening task has finished, but the user is still waiting
        // for these initial reads. Keep one task for this phase, owned by this
        // request so a late completion cannot remove a newer navigation's task.
        loadingJob = jobs.begin(t("operations.open"), path);
        // These independent reads should not make the user wait for one another.
        const results = await Promise.allSettled([
          changes.refresh(),
          log.load(true),
          branches.refresh(),
        ]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      }
    } catch (reason) {
      if (!current()) return;
      const message = formatErrorMessage(reason);
      if (workspace.folderPath) {
        // Applying the open result unmounts WelcomeView before these reads finish.
        toast(
          opened ? { title: t("rewrite.refreshFailed"), description: message } : { title: message },
        );
      } else {
        error.value = message;
      }
    } finally {
      if (loadingJob !== null) jobs.finished(loadingJob);
      // An obsolete completion cannot clear a newer operation's loading state.
      if (operation.value?.id === id) operation.value = null;
    }
  }

  const openFolder = () => open("folder");
  const openRecent = (path: string) => open("recent", path);
  // CloneDialog already announces the completed clone; this phase only opens
  // its result and shares the normal opening progress/error/navigation guards.
  const openCloned = (path: string) => open("clone", path);
  const createRepo = () => open("create");
  const enableVcs = () =>
    workspace.folderPath ? open("enable", workspace.folderPath) : Promise.resolve();

  return { pending, pendingPath, error, openFolder, openRecent, openCloned, createRepo, enableVcs };
}

export function useWorkspaceOpen() {
  return createWorkspaceOpen(useI18n().t);
}
