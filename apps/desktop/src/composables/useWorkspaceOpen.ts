import { computed, ref, shallowRef, type Ref, type ShallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore } from "@/stores/changesStore";
import { useLogStore } from "@/stores/logStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useBranchesStore } from "@/stores/branchesStore";
import { isTauri } from "@/lib/utils";
import { toast } from "@/composables/useToast";
import { promptDialog } from "@/composables/useConfirm";
import { formatErrorMessage } from "@/lib/errors";

type OpenOperation = { id: symbol; navigation: number; path: string | null };
type OpenState = {
  operation: ShallowRef<OpenOperation | null>;
  error: Ref<string | null>;
};
// Share the picker and pending state across entry points in one application,
// without carrying it into another Pinia instance or retaining closed instances.
const states = new WeakMap<ReturnType<typeof useWorkspaceStore>, OpenState>();

// Action enabled predicates read only the existing state. They must not create
// controllers or initialize unrelated stores while rendering menus.
export function isWorkspaceOpening() {
  const workspace = useWorkspaceStore();
  const operation = states.get(workspace)?.operation.value;
  return !!operation && operation.navigation === workspace.navigationToken();
}

// Actions run outside component setup and supply the global translator; the
// component wrapper below retains the local i18n scope.
export function createWorkspaceOpen(t: (key: string) => string) {
  const workspace = useWorkspaceStore();
  let state = states.get(workspace);
  if (!state) {
    state = { operation: shallowRef(null), error: ref(null) };
    states.set(workspace, state);
  }
  const { operation, error } = state;
  // Navigation from another entry retires this operation immediately; the old
  // backend read may still be pending, but must not lock the new workspace.
  const pending = computed(() => operation.value?.navigation === workspace.navigationToken());
  const pendingPath = computed(() => (pending.value ? (operation.value?.path ?? null) : null));
  const changes = useChangesStore();
  const log = useLogStore();
  const layout = useLayoutStore();
  const branches = useBranchesStore();

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

  async function open(kind: "recent" | "folder" | "create" | "enable", initialPath?: string) {
    if (pending.value) return;
    const id = Symbol("workspace open");
    let navigation = workspace.navigationToken();
    operation.value = { id, navigation, path: initialPath ?? null };
    error.value = null;
    const current = () => operation.value?.id === id && navigation === workspace.navigationToken();
    let opened = false;
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
      if (kind !== "recent") {
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
      // An obsolete completion cannot clear a newer operation's loading state.
      if (operation.value?.id === id) operation.value = null;
    }
  }

  const openFolder = () => open("folder");
  const openRecent = (path: string) => open("recent", path);
  const createRepo = () => open("create");
  const enableVcs = () =>
    workspace.folderPath ? open("enable", workspace.folderPath) : Promise.resolve();

  return { pending, pendingPath, error, openFolder, openRecent, createRepo, enableVcs };
}

export function useWorkspaceOpen() {
  return createWorkspaceOpen(useI18n().t);
}
