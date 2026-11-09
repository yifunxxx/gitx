import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { getBackend } from "@/lib/backend";
import type { ConflictEntry, ConflictsList, ConflictSide, Merge3Result } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useChangesStore } from "./changesStore";
import { useLayoutStore } from "./layoutStore";
import { toast } from "@/composables/useToast";

export type MergeTab = {
  id: string;
  path: string;
  title: string;
  merge3: Merge3Result | null;
  resultText: string;
  yoursLabel: string;
  theirsLabel: string;
};

export const useConflictsStore = defineStore("conflicts", () => {
  const list = ref<ConflictsList | null>(null);
  const loading = ref(false);
  const selected = ref<string[]>([]);
  const mergeTabs = ref<MergeTab[]>([]);
  const activeMergeId = ref<string | null>(null);

  let refreshGeneration = 0;
  const workspace = useWorkspaceStore();
  watch(
    () => workspace.repoPath,
    () => {
      ++refreshGeneration;
      list.value = null;
      selected.value = [];
      loading.value = false;
      mergeTabs.value = [];
      activeMergeId.value = null;
    },
    { flush: "sync" },
  );

  const entries = computed(() => list.value?.entries ?? []);
  const hasConflicts = computed(() => entries.value.length > 0);

  async function refresh() {
    const ws = useWorkspaceStore();
    const generation = ++refreshGeneration;
    const path = ws.repoPath;
    const navigation = ws.navigationToken();
    const current = () =>
      generation === refreshGeneration &&
      path === ws.repoPath &&
      navigation === ws.navigationToken();
    if (!ws.repoPath) {
      list.value = null;
      return;
    }
    loading.value = true;
    try {
      const result = await getBackend().conflictsList({ path: ws.repoPath });
      if (!current()) return;
      list.value = result;
      selected.value = selected.value.filter((p) => list.value!.entries.some((e) => e.path === p));
    } catch (error) {
      if (current()) throw error;
    } finally {
      if (generation === refreshGeneration) loading.value = false;
    }
  }

  function toggleSelect(path: string) {
    if (selected.value.includes(path)) {
      selected.value = selected.value.filter((p) => p !== path);
    } else {
      selected.value = [...selected.value, path];
    }
  }

  async function acceptSide(side: ConflictSide, paths?: string[]) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return;
    const targets = paths?.length ? paths : selected.value;
    if (!targets.length) return;
    await getBackend().conflictAcceptSide({
      path: ws.repoPath,
      paths: targets,
      side,
    });
    toast({ title: side === "ours" ? "Accepted Yours" : "Accepted Theirs" });
    await refresh();
    await useChangesStore().refresh();
  }

  async function resolveSimple() {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return;
    const n = await getBackend().conflictResolveSimple({ path: ws.repoPath });
    toast({ title: `Resolved ${n} simple conflict(s)` });
    await refresh();
    await useChangesStore().refresh();
  }

  async function openMerge(entry: ConflictEntry) {
    const ws = useWorkspaceStore();
    if (!ws.repoPath) return;
    const existing = mergeTabs.value.find((t) => t.path === entry.path);
    if (existing) {
      activeMergeId.value = existing.id;
      useLayoutStore().activeEditorKind = "merge";
      return;
    }
    const merge3 = await getBackend().conflictMerge3({
      path: ws.repoPath,
      filePath: entry.path,
    });
    const resultLines: string[] = [];
    for (const b of merge3.blocks) {
      if (b.kind === "conflict") {
        resultLines.push("<<<<<<< Yours");
        resultLines.push(...b.oursLines);
        resultLines.push("=======");
        resultLines.push(...b.theirsLines);
        resultLines.push(">>>>>>> Theirs");
      } else {
        resultLines.push(...b.resultLines);
      }
    }
    const id = `merge:${entry.path}:${Date.now()}`;
    mergeTabs.value.push({
      id,
      path: entry.path,
      title: `Merge: ${entry.path}`,
      merge3,
      resultText: resultLines.join("\n") + (resultLines.length ? "\n" : ""),
      yoursLabel: list.value?.yoursLabel ?? "Yours",
      theirsLabel: list.value?.theirsLabel ?? "Theirs",
    });
    activeMergeId.value = id;
    useLayoutStore().activeEditorKind = "merge";
  }

  function closeMergeTab(id: string) {
    mergeTabs.value = mergeTabs.value.filter((t) => t.id !== id);
    if (activeMergeId.value === id) {
      activeMergeId.value = mergeTabs.value[0]?.id ?? null;
      if (!activeMergeId.value) useLayoutStore().activeEditorKind = "welcome";
    }
  }

  async function applyMergeResult(id: string) {
    const ws = useWorkspaceStore();
    const tab = mergeTabs.value.find((t) => t.id === id);
    if (!ws.repoPath || !tab) return;
    await getBackend().conflictSaveResult({
      path: ws.repoPath,
      filePath: tab.path,
      content: tab.resultText,
    });
    toast({ title: `Resolved ${tab.path}` });
    closeMergeTab(id);
    await refresh();
    await useChangesStore().refresh();
  }

  function acceptBlock(tabId: string, blockIndex: number, side: "ours" | "theirs" | "result") {
    const tab = mergeTabs.value.find((t) => t.id === tabId);
    if (!tab?.merge3) return;
    const blocks = tab.merge3.blocks.map((b, i) => {
      if (i !== blockIndex) return b;
      if (side === "ours") {
        return { ...b, kind: "onlyOurs" as const, resultLines: [...b.oursLines], isSimple: true };
      }
      if (side === "theirs") {
        return {
          ...b,
          kind: "onlyTheirs" as const,
          resultLines: [...b.theirsLines],
          isSimple: true,
        };
      }
      return b;
    });
    tab.merge3 = {
      blocks,
      conflictCount: blocks.filter((b) => b.kind === "conflict").length,
    };
    tab.resultText =
      blocks
        .map((b) =>
          b.kind === "conflict"
            ? ["<<<<<<< Yours", ...b.oursLines, "=======", ...b.theirsLines, ">>>>>>> Theirs"].join(
                "\n",
              )
            : b.resultLines.join("\n"),
        )
        .filter((s) => s.length)
        .join("\n") + "\n";
  }

  return {
    list,
    loading,
    selected,
    entries,
    hasConflicts,
    mergeTabs,
    activeMergeId,
    refresh,
    toggleSelect,
    acceptSide,
    resolveSimple,
    openMerge,
    closeMergeTab,
    applyMergeResult,
    acceptBlock,
  };
});
