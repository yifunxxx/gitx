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
import { computed, markRaw, reactive, ref, type Raw } from "vue";
import { getBackend } from "@/lib/backend";
import type { ConflictEntry, ConflictsList, ConflictSide, Merge3Result } from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { useChangesStore } from "./changesStore";
import { useLayoutStore } from "./layoutStore";
import { toast } from "@/composables/useToast";
import { i18n } from "@/i18n";
import { formatErrorMessage } from "@/lib/errors";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { useRewriteStore } from "./rewriteStore";

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
  const refreshError = ref<string | null>(null);
  const selected = ref<string[]>([]);
  const mergeTabs = ref<MergeTab[]>([]);
  const activeMergeId = ref<string | null>(null);
  const initialMergeResults = new Map<string, string>();

  let refreshGeneration = 0;
  let contentGeneration = 0;
  let nextMergeId = 0;
  const pendingMerges = new Map<string, () => boolean>();
  // A write still owns its repository after navigation, until the backend settles.
  const pendingWrites = reactive(new Set<string>());
  const workspace = useWorkspaceStore();
  const busy = computed(() => !!workspace.repoPath && pendingWrites.has(workspace.repoPath));
  const capture = useRepositoryAction(() => {
    ++refreshGeneration;
    ++contentGeneration;
    pendingMerges.clear();
    list.value = null;
    selected.value = [];
    loading.value = false;
    refreshError.value = null;
    mergeTabs.value = [];
    initialMergeResults.clear();
    activeMergeId.value = null;
    if (useLayoutStore().activeEditorKind === "merge")
      useLayoutStore().activeEditorKind = "welcome";
  });

  const entries = computed(() => list.value?.entries ?? []);
  const hasConflicts = computed(() => entries.value.length > 0);

  async function refresh() {
    const source = capture();
    const generation = ++refreshGeneration;
    const current = () => generation === refreshGeneration && source.current();
    if (!source.path || !source.current()) {
      list.value = null;
      return false;
    }
    loading.value = true;
    try {
      const result = await getBackend().conflictsList({ path: source.path });
      if (!current()) return false;
      list.value = result;
      refreshError.value = null;
      selected.value = selected.value.filter((p) => list.value!.entries.some((e) => e.path === p));
      return true;
    } catch (error) {
      if (current()) {
        refreshError.value = formatErrorMessage(error);
        throw error;
      }
      return false;
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

  async function refreshAfterWrite(source: ReturnType<typeof capture>) {
    const results = await Promise.allSettled(
      [
        () => refresh(),
        () => useChangesStore().refresh(),
        () => useRewriteStore().refreshOpState(),
      ].map((reload) => Promise.resolve().then(async () => {
        if (source.current()) await reload();
      })),
    );
    if (!source.current()) return;
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") {
      refreshError.value = `${i18n.global.t("rewrite.refreshFailed")} ${formatErrorMessage(failure.reason)}`;
      toast({ title: refreshError.value, persistent: true });
    }
  }

  async function resolveFiles(side?: ConflictSide, paths?: string[]) {
    const source = capture();
    if (!source.path || !source.current() || busy.value || refreshError.value) return false;
    const targets = [...(paths ?? selected.value)];
    if (side && !targets.length) return false;
    pendingWrites.add(source.path);
    ++contentGeneration;
    pendingMerges.clear();
    try {
      const count = side
        ? await getBackend().conflictAcceptSide({ path: source.path, paths: targets, side })
        : await getBackend().conflictResolveSimple({ path: source.path });
      if (!source.current()) return false;
      if (side)
        for (const tab of [...mergeTabs.value])
          if (targets.includes(tab.path)) closeMergeTab(tab.id);
      toast({
        title: String(
          side
            ? i18n.global.t(side === "ours" ? "merge.acceptedYours" : "merge.acceptedTheirs")
            : i18n.global.t("merge.resolvedSimple", { count }),
        ),
      });
      await refreshAfterWrite(source);
      if (!side && source.current() && !refreshError.value) {
        for (const tab of [...mergeTabs.value])
          if (!entries.value.some((entry) => entry.path === tab.path)) closeMergeTab(tab.id);
      }
      return true;
    } catch (error) {
      if (source.current()) throw error;
      return false;
    } finally {
      pendingWrites.delete(source.path);
    }
  }

  function acceptSide(side: ConflictSide, paths?: string[]) {
    return resolveFiles(side, paths);
  }

  function resolveSimple() {
    return resolveFiles();
  }

  async function openMerge(entry: ConflictEntry, callerCurrent: () => boolean = () => true) {
    const source = capture();
    const generation = contentGeneration;
    const current = () => source.current() && callerCurrent() && generation === contentGeneration;
    if (
      !source.path ||
      !current() ||
      busy.value ||
      refreshError.value ||
      entry.kind === "binary" ||
      entry.kind === "submodule"
    )
      return false;
    const filePath = entry.path;
    const existing = mergeTabs.value.find((t) => t.path === entry.path);
    if (existing) {
      activeMergeId.value = existing.id;
      useLayoutStore().activeEditorKind = "merge";
      return true;
    }
    if (pendingMerges.get(filePath)?.()) return false;
    pendingMerges.set(filePath, current);
    const yoursLabel = list.value?.yoursLabel ?? "Yours";
    const theirsLabel = list.value?.theirsLabel ?? "Theirs";
    let merge3: Merge3Result;
    try {
      merge3 = await getBackend().conflictMerge3({ path: source.path, filePath });
    } catch (error) {
      if (current()) throw error;
      return false;
    } finally {
      if (pendingMerges.get(filePath) === current) pendingMerges.delete(filePath);
    }
    if (!current()) return false;
    const mergeState = markRaw(createMergeState(merge3));
    const id = `merge:${filePath}:${++nextMergeId}`;
    mergeTabs.value.push({
      id,
      path: filePath,
      title: String(i18n.global.t("merge.editorTitle", { path: filePath })),
      merge3,
      resultText: sourceText(mergeState),
      mergeState,
      saving: false,
      error: null,
      yoursLabel,
      theirsLabel,
    });
    initialMergeResults.set(id, mergeTabs.value.find((tab) => tab.id === id)!.resultText);
    activeMergeId.value = id;
    useLayoutStore().activeEditorKind = "merge";
    return true;
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
    const source = capture();
    const tab = mergeTabs.value.find((t) => t.id === id);
    if (!source.path || !source.current() || !tab || tab.saving || busy.value)
      return false;
    if (refreshError.value) {
      tab.error = refreshError.value;
      return false;
    }
    const state = syncMergeText(tab.mergeState, tab.resultText);
    if (pendingMergeCount(state) || /^([<>]{7})(?: |\r?$)/m.test(tab.resultText)) {
      tab.error = String(i18n.global.t("merge.unresolvedMarkers"));
      return false;
    }
    const current = () => source.current() && mergeTabs.value.includes(tab);
    pendingWrites.add(source.path);
    ++contentGeneration;
    pendingMerges.clear();
    tab.saving = true;
    tab.error = null;
    try {
      await getBackend().conflictSaveResult({
        path: source.path,
        filePath: tab.path,
        content: tab.resultText,
      });
      if (!current()) return false;
      toast({ title: String(i18n.global.t("merge.resolvedFile", { path: tab.path })) });
      closeMergeTab(id);
      await refreshAfterWrite(source);
      return true;
    } catch (error) {
      if (current()) tab.error = formatErrorMessage(error);
      return false;
    } finally {
      tab.saving = false;
      pendingWrites.delete(source.path);
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
    busy,
    refreshError,
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
