import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { confirmDialog, promptDialog } from "@/composables/useConfirm";
import { toast } from "@/composables/useToast";
import { useLogStore } from "@/stores/logStore";
import { useCompareStore } from "@/stores/compareStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useRepoAtRevStore } from "@/stores/repoAtRevStore";
import { useDiffStore } from "@/stores/diffStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import type { ChangedFile } from "@/lib/backend";
import { formatErrorMessage } from "@/lib/errors";

export type LogMenuTarget = {
  id: number;
  sha: string;
  shas: string[];
  parent: string;
  isHead: boolean;
  current: () => boolean;
  file?: ChangedFile;
};
type Rule = "any" | "single" | "pair" | "write" | "singleWrite" | "squash" | "uncommit" | "extract";
type PartialChanges = (
  target: LogMenuTarget,
  mode: "extract" | "drop",
  paths?: string[],
) => Promise<void>;
type FileListSource = { id: number; sha: string; files: ChangedFile[]; current: () => boolean };

/** A menu owns its target; an accepted action only outlives it in the same repository. */
export function useLogContextMenus(partialChanges?: PartialChanges) {
  const { t } = useI18n();
  const log = useLogStore();
  const compare = useCompareStore();
  const history = useHistoryStore();
  const repoAtRev = useRepoAtRevStore();
  const diffs = useDiffStore();
  const layout = useLayoutStore();
  const rewrite = useRewriteStore();
  const ctx = ref({ open: false, x: 0, y: 0 });
  const fileCtx = ref({ open: false, x: 0, y: 0 });
  const target = ref<LogMenuTarget | null>(null);
  const fileTarget = ref<LogMenuTarget | null>(null);
  const selectedFile = ref<ChangedFile | null>(null);
  let serial = 0;
  const capture = useRepositoryAction(() => {
    closeMenus();
    selectedFile.value = null;
  });
  const fileList = computed<FileListSource | null>(() => {
    const sha = log.selectedSha;
    const details = log.details;
    const files = log.changedFiles;
    const source = capture();
    if (!sha || details?.sha !== sha || !source.current()) return null;
    return {
      id: ++serial,
      sha,
      files,
      current: () =>
        source.current() &&
        log.selectedSha === sha &&
        log.details === details &&
        log.changedFiles === files,
    };
  });
  watch(
    () => [log.selectedSha, ...log.selectedShas],
    () => {
      closeMenus();
      selectedFile.value = null;
    },
    { flush: "sync" },
  );
  watch(
    () => log.changedFiles,
    () => closeFileCtx(),
    { flush: "sync" },
  );

  function closeCtx() {
    ctx.value.open = false;
    target.value = null;
  }
  function closeFileCtx() {
    fileCtx.value.open = false;
    fileTarget.value = null;
  }
  function closeMenus() {
    closeCtx();
    closeFileCtx();
  }
  function snapshot(sha: string): LogMenuTarget | null {
    const source = capture();
    const commit = log.commits.find((c) => c.sha === sha);
    if (!source.current() || !commit) return null;
    return {
      id: ++serial,
      sha,
      shas: [...log.selectedShas],
      parent: commit.parents[0] ?? "EMPTY",
      isHead: commit.refs.some((r) => r === "HEAD" || r.startsWith("HEAD -> ")),
      current: source.current,
    };
  }
  function openContext(sha: string, x: number, y: number) {
    closeMenus();
    target.value = snapshot(sha);
    ctx.value = { open: !!target.value, x, y };
  }
  function selectFile(file: ChangedFile) {
    closeMenus();
    selectedFile.value = file;
  }
  function resolveFile(list: FileListSource, file: ChangedFile) {
    if (!list.current()) return;
    // PathTreeList adds metadata to a copy; object identity is not preserved.
    return list.files.find(
      (item) =>
        item.path === file.path && item.origPath === file.origPath && item.status === file.status,
    );
  }
  function onFileContext(
    list: FileListSource,
    { file, x, y }: { file: ChangedFile; x: number; y: number },
  ) {
    closeMenus();
    const resolved = resolveFile(list, file);
    if (!resolved) return;
    const source = snapshot(list.sha);
    if (!source) return;
    selectedFile.value = resolved;
    fileTarget.value = { ...source, shas: [source.sha], file: { ...resolved } };
    fileCtx.value = { open: true, x, y };
  }
  function canRun(menu: LogMenuTarget, rule: Rule = "any") {
    const count = menu.shas.length;
    if (!count || !menu.current()) return false;
    const write = ["write", "singleWrite", "squash", "uncommit", "extract"].includes(rule);
    if (write && rewrite.busy) return false;
    if (["single", "singleWrite", "uncommit", "extract"].includes(rule) && count !== 1)
      return false;
    if (rule === "pair" && count !== 2) return false;
    if (rule === "squash" && count < 2) return false;
    if (rule === "uncommit" && !menu.isHead) return false;
    if (
      rule === "extract" &&
      !partialChanges &&
      (log.details?.sha !== menu.sha || !log.changedFiles.length)
    )
      return false;
    return true;
  }
  async function runMenu(
    menu: LogMenuTarget,
    action: (menu: LogMenuTarget) => Promise<unknown>,
    rule: Rule = "any",
  ) {
    if (menu !== target.value && menu !== fileTarget.value) return;
    if (!canRun(menu, rule)) return;
    closeMenus();
    await run(menu, action);
  }
  async function run(menu: LogMenuTarget, action: (menu: LogMenuTarget) => Promise<unknown>) {
    if (!menu.current()) return;
    try {
      await action(menu);
    } catch (error) {
      if (menu.current()) toast({ title: t("log.failed"), description: formatErrorMessage(error) });
    }
  }
  async function ctxCopy(menu: LogMenuTarget) {
    // An unavailable clipboard must not be reported as a successful copy.
    await navigator.clipboard.writeText(menu.sha);
    if (menu.current()) toast({ title: t("log.copiedRevision") });
  }
  async function ctxCompareLocal(menu: LogMenuTarget) {
    layout.bottomMaximized = false;
    await compare.compareWithLocal(menu.sha);
  }
  async function ctxCompareVersions(menu: LogMenuTarget) {
    layout.bottomMaximized = false;
    await compare.compareVersions(menu.shas[0]!, menu.shas[1]!);
  }
  async function ctxRepoAtRev(menu: LogMenuTarget) {
    layout.bottomMaximized = false;
    await repoAtRev.open(menu.sha);
  }
  async function ctxCombined(menu: LogMenuTarget) {
    layout.bottomMaximized = false;
    const tab = await compare.compareVersions(menu.parent, menu.sha);
    if (menu.current() && tab) await compare.showCombined(tab);
  }
  async function openCommitChanges(sha: string) {
    closeMenus();
    const menu = snapshot(sha);
    if (menu) await run(menu, ctxCombined);
  }
  async function fileDiff(menu: LogMenuTarget) {
    if (!menu.file) return;
    layout.bottomMaximized = false;
    await diffs.openRevDiff(menu.file.path, menu.parent, menu.sha, menu.file.origPath ?? undefined);
  }
  async function fileHistory(menu: LogMenuTarget) {
    if (!menu.file) return;
    layout.bottomMaximized = false;
    await history.openFileHistory(menu.file.path);
  }
  async function openChangedFile(list: FileListSource, file: ChangedFile) {
    closeMenus();
    const resolved = resolveFile(list, file);
    if (!resolved) return;
    const menu = snapshot(list.sha);
    if (menu) await run({ ...menu, file: { ...resolved } }, fileDiff);
  }
  async function ctxCherryPick(menu: LogMenuTarget) {
    await rewrite.cherryPick({ shas: [...menu.shas] });
  }
  async function ctxRevert(menu: LogMenuTarget) {
    await rewrite.revert([...menu.shas]);
  }
  async function ctxUncommit() {
    await rewrite.uncommit();
  }
  async function ctxReword(menu: LogMenuTarget) {
    const { openDialog } = await import("@/composables/useDialog");
    const dialog = (await import("@/features/merge/RewordDialog.vue")).default;
    if (menu.current() && !rewrite.busy) await openDialog(dialog, { sha: menu.sha });
  }
  async function ctxInteractive(menu: LogMenuTarget) {
    const { openDialog } = await import("@/composables/useDialog");
    const dialog = (await import("@/features/merge/InteractiveRebaseEditor.vue")).default;
    if (menu.current() && !rewrite.busy) await openDialog(dialog, { fromSha: menu.sha });
  }
  async function ctxReset(menu: LogMenuTarget) {
    const { openDialog } = await import("@/composables/useDialog");
    const dialog = (await import("@/features/merge/ResetDialog.vue")).default;
    if (menu.current() && !rewrite.busy) await openDialog(dialog, { target: menu.sha });
  }
  async function ctxSquash(menu: LogMenuTarget) {
    const { openDialog } = await import("@/composables/useDialog");
    const dialog = (await import("@/features/merge/SquashDialog.vue")).default;
    if (menu.current() && !rewrite.busy) await openDialog(dialog, { shas: [...menu.shas] });
  }
  async function ctxDrop(menu: LogMenuTarget) {
    const ok = await confirmDialog({
      title: t("actions.dropCommits"),
      message: t("log.dropConfirm", { count: menu.shas.length }),
      destructive: true,
    });
    if (ok && menu.current() && !rewrite.busy) await rewrite.drop([...menu.shas]);
  }
  async function ctxExtract(menu: LogMenuTarget) {
    const paths = menu.file ? [menu.file.path] : log.changedFiles.map((f) => f.path);
    if (partialChanges) return await partialChanges(menu, "extract", menu.file ? paths : undefined);
    const defaultMessage = t("log.extractedDefault");
    const message = await promptDialog({
      title: t("actions.extractSelected"),
      defaultValue: defaultMessage,
    });
    if (message !== null && message !== undefined && menu.current() && !rewrite.busy)
      await rewrite.extractChanges(menu.sha, paths, message || defaultMessage);
  }
  async function ctxDropChanges(menu: LogMenuTarget) {
    await partialChanges?.(menu, "drop", menu.file ? [menu.file.path] : undefined);
  }
  return {
    ctx,
    fileCtx,
    target,
    fileTarget,
    selectedFile,
    fileList,
    selectFile,
    openContext,
    onFileContext,
    closeCtx,
    closeFileCtx,
    closeMenus,
    canRun,
    runMenu,
    openChangedFile,
    ctxCopy,
    ctxCompareLocal,
    ctxCompareVersions,
    ctxRepoAtRev,
    ctxCombined,
    openCommitChanges,
    fileDiff,
    fileHistory,
    ctxCherryPick,
    ctxRevert,
    ctxUncommit,
    ctxReword,
    ctxInteractive,
    ctxReset,
    ctxSquash,
    ctxDrop,
    ctxExtract,
    ctxDropChanges,
  };
}
