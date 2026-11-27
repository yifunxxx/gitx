import { defineStore } from "pinia";
import { computed, onScopeDispose, ref, shallowRef } from "vue";
import { getBackend, type FsMutation, type FsOperation } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useFileTreeStore } from "./fileTreeStore";
import { useFileViewerStore, type FileViewerTab } from "./fileViewerStore";
import { useChangesStore } from "./changesStore";
import { confirmDialog, promptDialog } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import { formatErrorMessage } from "@/lib/errors";
import { i18n } from "@/i18n";
import { workspacePathKey } from "@/lib/workspacePath";
import { useJobsStore } from "./jobsStore";

export function topLevelPaths(paths: string[]): string[] {
  const selected = new Set(paths);
  // Only path prefixes ending at a separator can be ancestors. Looking them
  // up avoids comparing every selected file with every other file, while the
  // Set's insertion order preserves the user's batch order.
  return [...selected].filter((path) => {
    for (let end = path.indexOf("/"); end !== -1; end = path.indexOf("/", end + 1)) {
      if (selected.has(path.slice(0, end))) return false;
    }
    return true;
  });
}

export const useFileOperationsStore = defineStore("fileOperations", () => {
  const busy = ref(false);
  const workspace = useWorkspaceStore();
  const tree = useFileTreeStore();
  const viewer = useFileViewerStore();
  const jobs = useJobsStore();
  const t = i18n.global.t;
  const activity = shallowRef<{ operation: FsOperation; current: () => boolean } | null>(null);
  const activityTitle = computed(() =>
    activity.value?.current() ? t(`fileOps.running.${activity.value.operation}`) : "",
  );
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
    activity.value = null;
  });

  async function run(operation: FsOperation, paths: string[], destination?: string) {
    const folder = workspace.folderPath;
    if (disposed || busy.value || !folder) return;
    const navigation = workspace.navigationToken();
    const applied = workspace.appliedOpenToken();
    const current = () =>
      !disposed &&
      workspace.folderPath === folder &&
      workspace.navigationToken() === navigation &&
      workspace.appliedOpenToken() === applied;
    busy.value = true;
    let job: string | undefined;
    try {
      paths = topLevelPaths(paths);
      const create = operation === "createFile" || operation === "createDirectory";
      let items: FsMutation[];
      if (create) {
        const parent = paths[0] ?? "";
        const name = await promptDialog({
          title: t(`fileOps.${operation}`),
          message: t("fileOps.namePrompt"),
          allowEmpty: false,
        });
        if (name === null || !current()) return;
        items = [{ path: [parent, name].filter(Boolean).join("/"), destination: null }];
      } else if (operation === "delete") {
        if (!paths.length) return;
        if (
          !(await confirmDialog({
            title: t("fileOps.delete"),
            message: `${t("fileOps.deleteConfirm")}\n\n${paths.join("\n")}`,
            destructive: true,
          }))
        )
          return;
        items = paths.map((path) => ({ path, destination: null }));
      } else {
        if (!paths.length) return;
        let target = destination;
        if (target === undefined) {
          const answer = await promptDialog({
            title: t(`fileOps.${operation}`),
            message: t(
              paths.length > 1 ? "fileOps.destinationFolderPrompt" : "fileOps.destinationPrompt",
            ),
            defaultValue: paths.length === 1 ? paths[0] : "",
            allowEmpty: paths.length > 1,
          });
          if (answer === null || !current()) return;
          target = answer.replace(/\\/g, "/").replace(/\/+$/, "");
        }
        items = paths.map((path) => ({
          path,
          destination:
            destination !== undefined || paths.length > 1
              ? [target, path.split("/").at(-1)].filter(Boolean).join("/")
              : target!,
        }));
        if (
          destination !== undefined &&
          !(await confirmDialog({
            title: t(`fileOps.${operation}`),
            message: items.map((item) => `${item.path} → ${item.destination}`).join("\n"),
          }))
        )
          return;
      }
      if (!current()) return;
      if (operation === "rename" || operation === "move" || operation === "delete") {
        const contains = (path: string, full: string) => {
          const key = workspacePathKey(`${folder}/${path}`);
          const candidate = workspacePathKey(full);
          return candidate === key || candidate.startsWith(`${key}/`);
        };
        if (
          (workspace.roots ?? []).some((root) =>
            paths.some((path) => contains(path, root.worktreeRoot)),
          )
        ) {
          toast({ title: t("fileOps.repositoryRootProtected") });
          return;
        }
        const snapshot = useChangesStore().snapshot;
        if (
          snapshot?.repoId === workspace.repoId &&
          snapshot?.files.some(
            (file) =>
              file.kind === "unmerged" &&
              paths.some((path) => contains(path, `${workspace.repoPath}/${file.path}`)),
          )
        ) {
          toast({ title: t("fileOps.resolveConflictsFirst") });
          return;
        }
      }
      let affected = viewer.affectedByFiles(folder, paths);
      let confirmedDeletes: Map<FileViewerTab, string> | undefined;
      if (affected.some((tab) => tab.loading || tab.saving)) {
        toast({ title: t("fileOps.editorBusy") });
        return;
      }
      if (operation === "delete" && affected.some((tab) => tab.dirty)) {
        // Authorize only these tab instances and the text shown before the
        // confirmation. Failed recycling must leave every draft dirty.
        confirmedDeletes = new Map(
          affected.filter((tab) => tab.dirty).map((tab) => [tab, tab.text]),
        );
        if (
          !(await confirmDialog({
            title: t("fileOps.delete"),
            message: t("fileOps.discardAndDelete"),
            destructive: true,
          })) ||
          !current()
        )
          return;
      }
      if (operation === "copy" && affected.some((tab) => tab.dirty)) {
        if (
          !(await confirmDialog({
            title: t("fileOps.copy"),
            message: t("fileOps.copySavedContent"),
          })) ||
          !current()
        )
          return;
      }
      affected = viewer.affectedByFiles(folder, paths);
      if (affected.some((tab) => tab.loading || tab.saving)) {
        toast({ title: t("fileOps.editorBusy") });
        return;
      }
      if (
        (operation === "rename" || operation === "move") &&
        items.some(
          (item) =>
            item.destination &&
            viewer
              .affectedByFiles(folder, [item.destination])
              .some((tab) => !affected.includes(tab)),
        )
      ) {
        toast({ title: t("fileOps.destinationOpen") });
        return;
      }
      // Prompts and validation are not running disk work. Keep one task from
      // dispatch through refresh, including partial failures and navigation.
      job = jobs.begin(t(`fileOps.running.${operation}`), folder);
      activity.value = { operation, current };
      for (const tab of affected) tab.fileOperationPending = true;
      viewer.fileMutationPending = true;
      let result;
      try {
        result = await getBackend().fsMutate({ folderPath: folder, operation, items });
        if (!current()) return;
        // Remap before releasing the save lock, including synchronous watchers.
        viewer.applyFileMutation(folder, operation, result.completed, confirmedDeletes);
      } finally {
        viewer.fileMutationPending = false;
        for (const tab of affected) tab.fileOperationPending = false;
      }
      // A refresh failure must not turn a successful disk operation into a retry.
      await tree.refreshExpanded();
      if (!current()) return;
      if (workspace.isRepo) void useChangesStore().refresh(true);
      if (result.failures.length)
        toast({
          title: t("fileOps.failed"),
          description: result.failures
            .map((failure) => `${failure.path}: ${failure.message}`)
            .join("\n"),
        });
      else toast({ title: t("fileOps.completed") });
      if (create && operation === "createFile" && result.completed[0])
        await viewer.open(result.completed[0].path, { folderPath: folder });
    } catch (error) {
      if (current()) toast({ title: t("fileOps.failed"), description: formatErrorMessage(error) });
    } finally {
      if (job !== undefined) jobs.finished(job);
      activity.value = null;
      busy.value = false;
    }
  }
  return { busy, activityTitle, run };
});
