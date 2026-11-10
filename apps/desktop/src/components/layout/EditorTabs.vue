<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import EditorTabButton from "./EditorTabButton.vue";
import { confirmDialog } from "@/composables/useConfirm";
import WelcomeView from "@/features/welcome/WelcomeView.vue";
import DiffViewer from "@/features/diff/DiffViewer.vue";
import FileHistoryView from "@/features/history/FileHistoryView.vue";
import RepoAtRevisionView from "@/features/history/RepoAtRevisionView.vue";
import CompareView from "@/features/compare/CompareView.vue";
import MergeViewer from "@/features/merge/MergeViewer.vue";
import FileViewer from "@/features/file/FileViewer.vue";
import EmptyState from "@/components/common/EmptyState.vue";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useDiffStore } from "@/stores/diffStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useCompareStore } from "@/stores/compareStore";
import { useRepoAtRevStore } from "@/stores/repoAtRevStore";
import { useConflictsStore } from "@/stores/conflictsStore";
import { useFileViewerStore } from "@/stores/fileViewerStore";
import { useLayoutStore } from "@/stores/layoutStore";

const { t } = useI18n();
const workspace = useWorkspaceStore();
const diffs = useDiffStore();
const history = useHistoryStore();
const compare = useCompareStore();
const repoAtRev = useRepoAtRevStore();
const conflicts = useConflictsStore();
const fileViewer = useFileViewerStore();
const layout = useLayoutStore();

const activeDiff = computed(() =>
  diffs.activeId ? diffs.tabs.find((t) => t.id === diffs.activeId) : null,
);
const activeHistory = computed(() =>
  history.activeId ? history.tabs.find((t) => t.id === history.activeId) : null,
);
const activeCompare = computed(() =>
  compare.activeId ? compare.tabs.find((t) => t.id === compare.activeId) : null,
);
const activeRepo = computed(() =>
  repoAtRev.activeId ? repoAtRev.tabs.find((t) => t.id === repoAtRev.activeId) : null,
);
const activeFile = computed(() =>
  fileViewer.activeId ? fileViewer.tabs.find((t) => t.id === fileViewer.activeId) : null,
);

type EditorKind = "diff" | "history" | "compare" | "repoAtRev" | "merge" | "file";
type EditorTab = { kind: EditorKind; id: string; title: string };
type CloseScope = "current" | "others" | "right" | "all";
const tabBar = ref<HTMLElement | null>(null);
const closing = ref(false);
const menuEpoch = ref(0);
const tabKey = (tab: EditorTab) => JSON.stringify([tab.kind, tab.id]);
const tabEntries = (kind: EditorKind, items: { id: string; title: string }[] = []) =>
  items.map(({ id, title }) => ({ kind, id, title }));
// This order is also the visible order used by Close Tabs to the Right.
const editorTabs = computed(() => [
  ...tabEntries("diff", diffs.tabs),
  ...tabEntries("history", history.tabs),
  ...tabEntries("compare", compare.tabs),
  ...tabEntries("repoAtRev", repoAtRev.tabs),
  ...tabEntries("merge", conflicts.mergeTabs),
  ...tabEntries("file", fileViewer.tabs),
]);

function storeFor(kind: Exclude<EditorKind, "merge">) {
  return { diff: diffs, history, compare, repoAtRev, file: fileViewer }[kind];
}
function isActive(tab: EditorTab) {
  const id = tab.kind === "merge" ? conflicts.activeMergeId : storeFor(tab.kind).activeId;
  return layout.activeEditorKind === tab.kind && id === tab.id;
}
function activateTab(tab: EditorTab) {
  if (tab.kind === "merge") conflicts.activeMergeId = tab.id;
  else storeFor(tab.kind).activeId = tab.id;
  layout.activeEditorKind = tab.kind;
}

watch(
  () => [workspace.repoPath, workspace.folderPath],
  () => {
    ++menuEpoch.value;
  },
  { flush: "sync" },
);
onBeforeUnmount(() => {
  ++menuEpoch.value;
});

async function closeTabs(target: EditorTab | null, scope: CloseScope) {
  if (closing.value) return;
  const before = editorTabs.value;
  const targetKey = target ? tabKey(target) : null;
  const index = target ? before.findIndex((tab) => tabKey(tab) === targetKey) : -1;
  if (target && index < 0) return;
  const targets = before.filter((tab, i) => {
    if (scope === "all") return true;
    if (scope === "current") return tabKey(tab) === targetKey;
    if (scope === "others") return tabKey(tab) !== targetKey;
    return i > index;
  });
  if (!targets.length) return;
  closing.value = true;
  const epoch = menuEpoch.value;
  try {
    const dirty = targets.filter(
      (tab) => tab.kind === "merge" && conflicts.hasUnsavedMergeResult(tab.id),
    );
    if (
      dirty.length &&
      !(await confirmDialog({
        title: t("editorTabs.unsavedTitle"),
        message: t("editorTabs.unsavedMessage", { count: dirty.length }),
        confirmLabel: t("editorTabs.discardAndClose"),
        destructive: true,
      }))
    )
      return;
    if (epoch !== menuEpoch.value) return;
    const keys = new Set(targets.map(tabKey));
    const active = editorTabs.value.find(isActive);
    const activeIndex = active ? before.findIndex((tab) => tabKey(tab) === tabKey(active)) : -1;
    const remaining = editorTabs.value.filter((tab) => !keys.has(tabKey(tab)));
    let next = active && !keys.has(tabKey(active)) ? active : undefined;
    if (scope === "others") next = target ?? undefined;
    else if (active && !next) {
      next =
        before.slice(activeIndex + 1).find((tab) => !keys.has(tabKey(tab))) ??
        before
          .slice(0, activeIndex)
          .reverse()
          .find((tab) => !keys.has(tabKey(tab))) ??
        remaining[0];
    }
    for (const tab of targets) {
      if (tab.kind === "merge") conflicts.closeMergeTab(tab.id);
      else storeFor(tab.kind).closeTab(tab.id);
    }
    if (next) activateTab(next);
    else showWorkspace();
    await nextTick();
    if (epoch !== menuEpoch.value) return;
    const focusKey = next ? tabKey(next) : "workspace";
    const activeKey = editorTabs.value.find(isActive);
    if ((activeKey ? tabKey(activeKey) : "workspace") !== focusKey) return;
    Array.from(tabBar.value?.querySelectorAll<HTMLButtonElement>("[data-editor-key]") ?? [])
      .find((button) => button.dataset.editorKey === focusKey)
      ?.focus({ preventScroll: true });
  } finally {
    closing.value = false;
  }
}

function showWorkspace() {
  diffs.activeId = null;
  history.activeId = null;
  compare.activeId = null;
  repoAtRev.activeId = null;
  conflicts.activeMergeId = null;
  fileViewer.activeId = null;
  layout.activeEditorKind = "welcome";
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-dbx-content">
    <div
      ref="tabBar"
      class="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b bg-dbx-chrome px-1 text-xs"
    >
      <EditorTabButton
        tab-key="workspace"
        :title="workspace.folderPath ? t('chrome.workspaceTab') : t('chrome.welcomeTab')"
        :active="layout.activeEditorKind === 'welcome'"
        :closable="false"
        :has-others="editorTabs.length > 0"
        :has-right="editorTabs.length > 0"
        :has-tabs="editorTabs.length > 0"
        :busy="closing"
        :menu-epoch="menuEpoch"
        @activate="showWorkspace"
        @close="closeTabs(null, $event)"
      />
      <EditorTabButton
        v-for="(tab, index) in editorTabs"
        :key="tabKey(tab)"
        :tab-key="tabKey(tab)"
        :title="tab.title"
        :active="isActive(tab)"
        :closable="true"
        :has-others="editorTabs.length > 1"
        :has-right="index < editorTabs.length - 1"
        :has-tabs="true"
        :busy="closing"
        :menu-epoch="menuEpoch"
        @activate="activateTab(tab)"
        @close="closeTabs(tab, $event)"
      />
    </div>

    <div class="min-h-0 flex-1">
      <DiffViewer
        v-if="layout.activeEditorKind === 'diff' && activeDiff"
        :key="activeDiff.id"
        :tab-id="activeDiff.id"
      />
      <FileHistoryView
        v-else-if="layout.activeEditorKind === 'history' && activeHistory"
        :tab-id="activeHistory.id"
      />
      <CompareView
        v-else-if="layout.activeEditorKind === 'compare' && activeCompare"
        :tab-id="activeCompare.id"
      />
      <RepoAtRevisionView
        v-else-if="layout.activeEditorKind === 'repoAtRev' && activeRepo"
        :tab-id="activeRepo.id"
      />
      <MergeViewer v-else-if="layout.activeEditorKind === 'merge'" />
      <FileViewer
        v-else-if="layout.activeEditorKind === 'file' && activeFile"
        :tab-id="activeFile.id"
      />
      <WelcomeView v-else-if="!workspace.folderPath" />
      <div v-else class="space-y-2 p-6 text-sm">
        <div class="font-medium">{{ t("chrome.workspaceTab") }}</div>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <dt>{{ t("workspace.path") }}</dt>
          <dd class="font-mono text-foreground">{{ workspace.folderPath }}</dd>
          <dt>{{ t("workspace.repository") }}</dt>
          <dd>{{ workspace.isRepo ? t("workspace.yes") : t("workspace.no") }}</dd>
          <dt>{{ t("workspace.branch") }}</dt>
          <dd>{{ workspace.branch?.head ?? "—" }}</dd>
          <dt>{{ t("workspace.git") }}</dt>
          <dd class="font-mono">
            <template v-if="workspace.gitVersion">{{ workspace.gitVersion }}</template>
            <span v-else-if="workspace.gitError" class="text-destructive">
              {{ workspace.gitError }}
            </span>
            <span v-else>{{ t("common.loading") }}</span>
          </dd>
        </dl>
        <p v-if="workspace.gitError" class="text-xs text-destructive">
          {{ t("git.detectHint") }}
        </p>
        <EmptyState
          v-if="workspace.isRepo"
          class="!h-auto !justify-start pt-6"
          :title="t('workspace.ready')"
          :description="t('workspace.readyHint')"
        />
      </div>
    </div>
  </section>
</template>
