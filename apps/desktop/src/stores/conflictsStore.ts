import type { EditorState } from "@codemirror/state";
import { sourceText } from "@/components/common/preservedText";
import {
  createMergeState,
  decideMergeSide,
  hasMergeDecisions,
  pendingMergeCount,
  syncMergeText,
} from "@/features/merge/mergeDocument";
import { defineStore } from "pinia";
import { computed, markRaw, ref, watch, type Raw } from "vue";
import { getBackend } from "@/lib/backend";
import type { ConflictEntry, ConflictsList, ConflictSide, Merge3Result } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useChangesStore } from "./changesStore";
import { useLayoutStore } from "./layoutStore";
import { toast } from "@/composables/useToast";
import { i18n } from "@/i18n";
import { formatErrorMessage } from "@/lib/errors";

export type MergeTab = {
  id: string;
  path: string;
  title: string;
  merge3: Merge3Result | null;
  resultText: string;
  mergeState: Raw<EditorState>;
  yoursLabel: string;
  theirsLabel: string;
  saving: boolean;
  error: string | null;
};

export const useConflictsStore = defineStore("conflicts", () => {
  const list = ref<ConflictsList | null>(null);
  const loading = ref(false);
  const selected = ref<string[]>([]);
  const mergeTabs = ref<MergeTab[]>([]);
  const activeMergeId = ref<string | null>(null);
  const initialMergeResults = new Map<string, string>();

  let refreshGeneration = 0;
  let mergeGeneration = 0;
  let nextMergeId = 0;
  const pendingMerges = new Set<string>();
  const workspace = useWorkspaceStore();
  watch(
    () => workspace.repoPath,
    () => {
      ++refreshGeneration;
      ++mergeGeneration;
      pendingMerges.clear();
      list.value = null;
      selected.value = [];
      loading.value = false;
      mergeTabs.value = [];
      initialMergeResults.clear();
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
    if (pendingMerges.has(entry.path)) return;
    const generation = mergeGeneration;
    pendingMerges.add(entry.path);
    let merge3: Merge3Result;
    try {
      merge3 = await getBackend().conflictMerge3({ path: ws.repoPath, filePath: entry.path });
    } finally {
      if (generation === mergeGeneration) pendingMerges.delete(entry.path);
    }
    if (generation !== mergeGeneration) return;
    const mergeState = markRaw(createMergeState(merge3));
    const id = `merge:${entry.path}:${++nextMergeId}`;
    mergeTabs.value.push({
      id,
      path: entry.path,
      title: String(i18n.global.t("merge.editorTitle", { path: entry.path })),
      merge3,
      resultText: sourceText(mergeState),
      mergeState,
      saving: false,
      error: null,
      yoursLabel: list.value?.yoursLabel ?? "Yours",
      theirsLabel: list.value?.theirsLabel ?? "Theirs",
    });
    initialMergeResults.set(id, mergeTabs.value.find((tab) => tab.id === id)!.resultText);
    activeMergeId.value = id;
    useLayoutStore().activeEditorKind = "merge";
  }

  function closeMergeTab(id: string) {
    initialMergeResults.delete(id);
    mergeTabs.value = mergeTabs.value.filter((t) => t.id !== id);
    if (activeMergeId.value === id) {
      activeMergeId.value = mergeTabs.value[0]?.id ?? null;
      if (!activeMergeId.value) useLayoutStore().activeEditorKind = "welcome";
    }
  }

  function hasUnsavedMergeResult(id: string) {
    const tab = mergeTabs.value.find((item) => item.id === id);
    return (
      !!tab && (tab.resultText !== initialMergeResults.get(id) || hasMergeDecisions(tab.mergeState))
    );
  }

  async function applyMergeResult(id: string) {
    const ws = useWorkspaceStore();
    const tab = mergeTabs.value.find((t) => t.id === id);
    if (!ws.repoPath || !tab || tab.saving) return false;
    const state = syncMergeText(tab.mergeState, tab.resultText);
    if (pendingMergeCount(state) || /^([<>]{7})(?: |\r?$)/m.test(tab.resultText)) {
      tab.error = String(i18n.global.t("merge.unresolvedMarkers"));
      return false;
    }
    const path = ws.repoPath;
    const navigation = ws.navigationToken();
    const current = () =>
      path === ws.repoPath && navigation === ws.navigationToken() && mergeTabs.value.includes(tab);
    tab.saving = true;
    tab.error = null;
    try {
      await getBackend().conflictSaveResult({ path, filePath: tab.path, content: tab.resultText });
      if (!current()) return false;
      toast({ title: String(i18n.global.t("merge.resolvedFile", { path: tab.path })) });
      closeMergeTab(id);
      await refresh();
      await useChangesStore().refresh();
      return true;
    } catch (error) {
      if (current()) tab.error = formatErrorMessage(error);
      return false;
    } finally {
      tab.saving = false;
    }
  }

  function updateMergeState(id: string, state: EditorState) {
    const tab = mergeTabs.value.find((t) => t.id === id);
    if (!tab || tab.saving) return;
    tab.mergeState = markRaw(state);
    tab.resultText = sourceText(state);
    tab.error = null;
  }

  function acceptBlock(tabId: string, blockIndex: number, side: "ours" | "theirs" | "result") {
    const tab = mergeTabs.value.find((t) => t.id === tabId);
    if (!tab?.merge3 || tab.saving || side === "result") return;
    const state = syncMergeText(tab.mergeState, tab.resultText);
    const spec = decideMergeSide(state, tab.merge3, blockIndex, side, "accept", true);
    if (!spec) {
      tab.error = String(i18n.global.t("merge.manuallyEdited"));
      return;
    }
    updateMergeState(tabId, state.update(spec).state);
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
    hasUnsavedMergeResult,
    applyMergeResult,
    acceptBlock,
    updateMergeState,
  };
});
