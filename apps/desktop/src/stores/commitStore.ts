import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { getBackend } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useChangesStore } from "./changesStore";
import { toast } from "@/composables/useToast";
import { formatErrorMessage } from "@/lib/errors";

export const useCommitStore = defineStore("commit", () => {
  const message = ref("");
  const amend = ref(false);
  const runHooks = ref(true);
  const committing = ref(false);
  const draftBeforeAmend = ref("");

  const workspace = useWorkspaceStore();

  watch(
    () => workspace.repoPath,
    (path) => {
      if (!path) {
        message.value = "";
        amend.value = false;
        return;
      }
      const key = `gitx.commitDraft.${path}`;
      message.value = localStorage.getItem(key) ?? "";
    },
    { immediate: true },
  );

  watch(message, (v) => {
    if (!workspace.repoPath) return;
    localStorage.setItem(`gitx.commitDraft.${workspace.repoPath}`, v);
  });

  async function setAmend(value: boolean) {
    if (value === amend.value) return;
    const backend = getBackend();
    if (value) {
      draftBeforeAmend.value = message.value;
      if (workspace.repoPath) {
        try {
          message.value = await backend.commitHeadMessage({ path: workspace.repoPath });
        } catch {
          /* keep draft */
        }
      }
      amend.value = true;
    } else {
      message.value = draftBeforeAmend.value;
      amend.value = false;
    }
  }

  async function commit() {
    if (!workspace.repoPath || !workspace.repoId) {
      toast({ title: "No repository", description: "Open a git repository first" });
      return;
    }
    if (!message.value.trim()) {
      toast({ title: "Empty message", description: "Enter a commit message" });
      return;
    }
    committing.value = true;
    try {
      const backend = getBackend();
      const changes = useChangesStore();
      const paths =
        !changes.stagingMode && changes.checkedPaths.length
          ? [...changes.checkedPaths]
          : null;
      const result = await backend.commitCreate({
        repoId: workspace.repoId,
        path: workspace.repoPath,
        message: message.value,
        amend: amend.value,
        noVerify: !runHooks.value,
        paths,
      });
      toast({
        title: result.amended ? "Amended" : "Committed",
        description: `${result.sha.slice(0, 7)} ${result.subject}`,
      });
      message.value = "";
      amend.value = false;
      localStorage.removeItem(`gitx.commitDraft.${workspace.repoPath}`);
      changes.setChecked([]);
      await changes.refresh();
      return result;
    } catch (e) {
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
      committing.value = false;
    }
  }

  return {
    message,
    amend,
    runHooks,
    committing,
    setAmend,
    commit,
  };
});
