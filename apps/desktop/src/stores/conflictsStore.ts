import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { getBackend } from "@/lib/backend";
import type { ConflictEntry, ConflictsList, ConflictSide, Merge3Result } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useChangesStore } from "./changesStore";
import { useLayoutStore } from "./layoutStore";
import { toast } from "@/composables/useToast";
import { formatErrorMessage } from "@/lib/errors";
import { i18n } from "@/i18n";
import {
  acceptConflictBlock,
  renderMergeResult,
  unresolvedConflictCount,
} from "@/features/merge/mergeResult";
import { useRewriteStore } from "./rewriteStore";

export type MergeTab = {
  id: string;
  path: string;
  title: string;
  merge3: Merge3Result | null;
  resultText: string;
  yoursLabel: string;
  theirsLabel: string;
  saving: boolean;
  error: string | null;
};

export const useConflictsStore = defineStore("conflicts", () => {
  const list = ref<ConflictsList | null>(null);
  const loading = ref(false);
  const busy = ref(false);
  const selected = ref<string[]>([]);
  const mergeTabs = ref<MergeTab[]>([]);
  const activeMergeId = ref<string | null>(null);
  const workspace = useWorkspaceStore();
  let repoGeneration = 0;
  let refreshGeneration = 0;
  let nextMergeId = 0;
  const pendingMerges = new Set<string>();
  watch(
    () => workspace.repoPath,
    () => {
      ++repoGeneration;
      ++refreshGeneration;
      list.value = null;
      selected.value = [];
      loading.value = false;
      busy.value = false;
      mergeTabs.value = [];
      activeMergeId.value = null;
      pendingMerges.clear();
      if (useLayoutStore().activeEditorKind === "merge")
        useLayoutStore().activeEditorKind = "welcome";
    },
    { flush: "sync" },
  );

  const entries = computed(() => list.value?.entries ?? []);
  const hasConflicts = computed(() => entries.value.length > 0);

  async function refresh() {
    const generation = ++refreshGeneration;
    const ws = useWorkspaceStore();
    if (!ws.repoPath) {
      list.value = null;
      return;
    }
    loading.value = true;
    try {
      const result = await getBackend().conflictsList({ path: ws.repoPath });
      if (generation !== refreshGeneration) return;
      list.value = result;
      selected.value = selected.value.filter((p) => list.value!.entries.some((e) => e.path === p));
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
    if (!ws.repoPath || busy.value) return;
    const targets = [...(paths?.length ? paths : selected.value)];
    if (!targets.length) return;
    const generation = repoGeneration;
    busy.value = true;
    try {
      await getBackend().conflictAcceptSide({ path: ws.repoPath, paths: targets, side });
      if (generation !== repoGeneration) return;
      for (const tab of mergeTabs.value) if (targets.includes(tab.path)) closeMergeTab(tab.id);
      toast({
        title: String(
          i18n.global.t(side === "ours" ? "merge.acceptedYours" : "merge.acceptedTheirs"),
        ),
      });
      await Promise.all([
        refresh(),
        useChangesStore().refresh(),
        useRewriteStore().refreshOpState(),
      ]);
    } finally {
      if (generation === repoGeneration) busy.value = false;
    }
  }

  async function resolveSimple() {
    const ws = useWorkspaceStore();
    if (!ws.repoPath || busy.value) return;
    const generation = repoGeneration;
    busy.value = true;
    try {
      const n = await getBackend().conflictResolveSimple({ path: ws.repoPath });
      if (generation !== repoGeneration) return;
      toast({ title: String(i18n.global.t("merge.resolvedSimple", { count: n })) });
      await Promise.all([
        refresh(),
        useChangesStore().refresh(),
        useRewriteStore().refreshOpState(),
      ]);
    } finally {
      if (generation === repoGeneration) busy.value = false;
    }
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
    if (pendingMerges.has(entry.path)) return;
    const generation = repoGeneration;
    pendingMerges.add(entry.path);
    let merge3: Merge3Result;
    try {
      merge3 = await getBackend().conflictMerge3({ path: ws.repoPath, filePath: entry.path });
    } finally {
      if (generation === repoGeneration) pendingMerges.delete(entry.path);
    }
    if (generation !== repoGeneration) return;
    const id = `merge:${entry.path}:${++nextMergeId}`;
    mergeTabs.value.push({
      id,
      path: entry.path,
      title: String(i18n.global.t("merge.editorTitle", { path: entry.path })),
      merge3,
      resultText: renderMergeResult(merge3),
      yoursLabel: list.value?.yoursLabel ?? "Yours",
      theirsLabel: list.value?.theirsLabel ?? "Theirs",
      saving: false,
      error: null,
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
    if (!ws.repoPath || !tab || tab.saving) return false;
    if (unresolvedConflictCount(tab.resultText)) {
      tab.error = String(i18n.global.t("merge.unresolvedMarkers"));
      return false;
    }
    const generation = repoGeneration;
    tab.saving = true;
    tab.error = null;
    try {
      await getBackend().conflictSaveResult({
        path: ws.repoPath,
        filePath: tab.path,
        content: tab.resultText,
      });
      if (generation !== repoGeneration) return false;
      toast({ title: String(i18n.global.t("merge.resolvedFile", { path: tab.path })) });
      closeMergeTab(id);
      await Promise.all([
        refresh(),
        useChangesStore().refresh(),
        useRewriteStore().refreshOpState(),
      ]);
      return true;
    } catch (error) {
      if (generation === repoGeneration) tab.error = formatErrorMessage(error);
      return false;
    } finally {
      tab.saving = false;
    }
  }

  function acceptBlock(tabId: string, blockIndex: number, side: "ours" | "theirs" | "result") {
    const tab = mergeTabs.value.find((t) => t.id === tabId);
    if (!tab?.merge3 || tab.saving || side === "result") return;
    const block = tab.merge3.blocks[blockIndex];
    if (!block || block.kind !== "conflict") return;
    const nextText = acceptConflictBlock(tab.resultText, block, blockIndex, side);
    if (nextText === null) {
      tab.error = String(i18n.global.t("merge.manuallyEdited"));
      return;
    }
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
    tab.resultText = nextText;
    tab.error = null;
  }

  return {
    list,
    loading,
    busy,
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
