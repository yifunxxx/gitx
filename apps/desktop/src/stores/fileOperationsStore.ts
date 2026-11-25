import { defineStore } from "pinia";
import { ref } from "vue";
import { getBackend, type FsMutation, type FsOperation } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useFileTreeStore } from "./fileTreeStore";
import { useFileViewerStore } from "./fileViewerStore";
import { useChangesStore } from "./changesStore";
import { confirmDialog, promptDialog } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import { formatErrorMessage } from "@/lib/errors";
import { i18n } from "@/i18n";
import { workspacePathKey } from "@/lib/workspacePath";

export function topLevelPaths(paths: string[]): string[] {
  return [...new Set(paths)].filter(
    (path, _, all) => !all.some((parent) => parent !== path && path.startsWith(`${parent}/`)),
  );
}

export const useFileOperationsStore = defineStore("fileOperations", () => {
  const busy = ref(false);
  const workspace = useWorkspaceStore();
  const tree = useFileTreeStore();
  const viewer = useFileViewerStore();
  const t = i18n.global.t;

  async function run(operation: FsOperation, paths: string[], destination?: string) {
    const folder = workspace.folderPath;
    if (busy.value || !folder) return;
    const navigation = workspace.navigationToken();
    const applied = workspace.appliedOpenToken();
    const current = () =>
      workspace.folderPath === folder &&
      workspace.navigationToken() === navigation &&
      workspace.appliedOpenToken() === applied;
    busy.value = true;
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
      if (affected.some((tab) => tab.loading || tab.saving)) {
        toast({ title: t("fileOps.editorBusy") });
        return;
      }
      if (operation === "delete" && affected.some((tab) => tab.dirty)) {
        toast({ title: t("fileOps.unsavedDelete") });
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
      for (const tab of affected) tab.fileOperationPending = true;
      viewer.fileMutationPending = true;
      let result;
      try {
        result = await getBackend().fsMutate({ folderPath: folder, operation, items });
        if (!current()) return;
        // Remap before releasing the save lock, including synchronous watchers.
        viewer.applyFileMutation(folder, operation, result.completed);
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
      busy.value = false;
    }
  }
  return { busy, run };
});
