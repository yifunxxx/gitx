import { defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { getBackend } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useChangesStore } from "./changesStore";
import { toast } from "@/composables/useToast";
import { useRewriteStore } from "./rewriteStore";
import { formatErrorMessage } from "@/lib/errors";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { useBranchesStore } from "./branchesStore";
import { useLogStore } from "./logStore";
import { i18n } from "@/i18n";

export const useCommitStore = defineStore("commit", () => {
  const message = ref("");
  const amend = ref(false);
  const runHooks = ref(true);
  const amendLoading = ref(false);
  const amendError = ref("");
  const workspace = useWorkspaceStore();
  const changes = useChangesStore();
  const pendingPaths = reactive(new Set<string>());
  const committing = computed(() => !!workspace.repoPath && pendingPaths.has(workspace.repoPath));
  const drafts = new Map<string, string>();
  const storageWarnings = new Set<string>();
  let draftPath: string | null = null;
  let draftBeforeAmend = "";
  let displayingMessage = false;
  let messageRevision = 0;
  let selectionRevision = 0;
  let amendRequest = 0;

  function storageWarning(path: string) {
    if (storageWarnings.has(path)) return;
    storageWarnings.add(path);
    toast({
      title: i18n.global.t("commit.draftStorageFailed"),
      description: i18n.global.t("commit.draftStorageHint"),
      persistent: true,
    });
  }

  function readDraft(path: string) {
    if (drafts.has(path)) return drafts.get(path)!;
    try {
      return localStorage.getItem(`gitx.commitDraft.${path}`) ?? "";
    } catch {
      storageWarning(path);
      return "";
    }
  }

  function saveDraft(path: string, value: string) {
    drafts.set(path, value);
    try {
      if (value) localStorage.setItem(`gitx.commitDraft.${path}`, value);
      else localStorage.removeItem(`gitx.commitDraft.${path}`);
      drafts.delete(path);
    } catch {
      storageWarning(path);
    }
  }

  function showMessage(value: string) {
    displayingMessage = true;
    try {
      message.value = value;
    } finally {
      displayingMessage = false;
    }
  }

  watch(
    message,
    (value) => {
      ++messageRevision;
      if (!displayingMessage && draftPath) saveDraft(draftPath, value);
    },
    { flush: "sync" },
  );
  watch(
    () => [changes.stagingMode, ...changes.checkedPaths],
    () => {
      ++selectionRevision;
    },
    { flush: "sync" },
  );

  function resetSession() {
    ++amendRequest;
    amend.value = false;
    amendLoading.value = false;
    amendError.value = "";
    draftBeforeAmend = "";
    draftPath = workspace.isRepo ? workspace.repoPath : null;
    showMessage(draftPath ? readDraft(draftPath) : "");
  }
  const captureOperation = useRepositoryAction(resetSession);
  resetSession();

  async function setAmend(value: boolean) {
    if (committing.value || useRewriteStore().busy) return;
    if (value === amend.value && (!value || !amendError.value)) return;
    const source = captureOperation();
    if (!source.current() || !source.path) return;
    const request = ++amendRequest;
    if (!value) {
      amend.value = false;
      amendLoading.value = false;
      amendError.value = "";
      showMessage(draftBeforeAmend);
      saveDraft(source.path, draftBeforeAmend);
      return;
    }
    if (!amend.value) draftBeforeAmend = message.value;
    amend.value = true;
    amendLoading.value = true;
    amendError.value = "";
    const revision = messageRevision;
    const current = () => source.current() && request === amendRequest;
    try {
      const headMessage = await getBackend().commitHeadMessage({ path: source.path });
      if (current() && revision === messageRevision) showMessage(headMessage);
    } catch (error) {
      if (current()) amendError.value = formatErrorMessage(error);
    } finally {
      if (current()) amendLoading.value = false;
    }
  }

  async function commit() {
    if (committing.value || amendLoading.value || amendError.value || useRewriteStore().busy)
      return;
    const source = captureOperation();
    if (!source.current() || !source.path || !source.repoId) {
      toast({ title: "No repository", description: "Open a git repository first" });
      return;
    }
    if (!message.value.trim()) {
      toast({ title: "Empty message", description: "Enter a commit message" });
      return;
    }
    const revision = messageRevision;
    const selection = selectionRevision;
    const wasAmend = amend.value;
    const ordinaryDraft = draftBeforeAmend;
    const paths =
      !changes.stagingMode && changes.checkedPaths.length ? [...changes.checkedPaths] : null;
    pendingPaths.add(source.path);
    try {
      const result = await getBackend().commitCreate({
        repoId: source.repoId,
        path: source.path,
        message: message.value,
        amend: wasAmend,
        noVerify: !runHooks.value,
        paths,
      });
      if (!source.current()) return result;
      toast({
        title: result.amended ? "Amended" : "Committed",
        description: result.warning || `${result.sha.slice(0, 7)} ${result.subject}`,
        persistent: !!result.warning,
      });
      if (revision === messageRevision) {
        const nextDraft = wasAmend ? ordinaryDraft : "";
        showMessage(nextDraft);
        saveDraft(source.path, nextDraft);
      }
      amend.value = false;
      ++amendRequest;
      if (selection === selectionRevision) changes.setChecked([]);
      // A refresh/storage failure must never turn a successful commit into a retry prompt.
      await Promise.allSettled(
        [
          () => changes.refresh(),
          () => useRewriteStore().refreshOpState(),
          () => useBranchesStore().refresh(),
          () => useLogStore().load(true, true),
        ].map((refresh) =>
          Promise.resolve().then(async () => {
            if (source.current()) await refresh();
          }),
        ),
      );
      return result;
    } catch (e) {
      if (!source.current()) throw e;
      const err = e as { code?: string; message?: string; gitStderr?: string };
      if (err.code === "hookFailed") {
        toast({
          title: "Hook failed",
          description: err.gitStderr ?? err.message ?? "pre-commit hook failed",
        });
      } else if (err.code === "nothingToCommit") {
        toast({ title: "Nothing to commit" });
      } else {
        toast({
          title: "Commit failed",
          description: formatErrorMessage(e),
        });
      }
      throw e;
    } finally {
      pendingPaths.delete(source.path);
    }
  }

  return {
    message,
    amend,
    runHooks,
    committing,
    amendLoading,
    amendError,
    setAmend,
    commit,
  };
});
