<script setup lang="ts">
import { computed, watch } from "vue";
import { X } from "@lucide/vue";
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

watch(
  () => diffs.activeId,
  (id) => {
    if (id) layout.activeEditorKind = "diff";
  },
);

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
    <div class="flex h-8 items-center gap-1 overflow-x-auto border-b bg-dbx-chrome px-1 text-xs">
      <button
        type="button"
        class="rounded-sm px-2 py-0.5"
        :class="
          layout.activeEditorKind === 'welcome'
            ? 'bg-background text-foreground ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent'
        "
        @click="showWorkspace"
      >
        {{ workspace.folderPath ? "Workspace" : "Welcome" }}
      </button>
      <button
        v-for="tab in diffs.tabs"
        :key="tab.id"
        type="button"
        class="group flex items-center gap-1 rounded-sm px-2 py-0.5"
        :class="
          layout.activeEditorKind === 'diff' && diffs.activeId === tab.id
            ? 'bg-background text-foreground ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent'
        "
        @click="diffs.activeId = tab.id; layout.activeEditorKind = 'diff'"
      >
        <span class="max-w-[140px] truncate">{{ tab.title }}</span>
        <span
          class="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
          @click.stop="diffs.closeTab(tab.id)"
        >
          <X class="h-3 w-3" />
        </span>
      </button>
      <button
        v-for="tab in history.tabs"
        :key="tab.id"
        type="button"
        class="group flex items-center gap-1 rounded-sm px-2 py-0.5"
        :class="
          layout.activeEditorKind === 'history' && history.activeId === tab.id
            ? 'bg-background text-foreground ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent'
        "
        @click="history.activeId = tab.id; layout.activeEditorKind = 'history'"
      >
        <span class="max-w-[160px] truncate">{{ tab.title }}</span>
        <span
          class="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
          @click.stop="history.closeTab(tab.id)"
        >
          <X class="h-3 w-3" />
        </span>
      </button>
      <button
        v-for="tab in compare.tabs"
        :key="tab.id"
        type="button"
        class="group flex items-center gap-1 rounded-sm px-2 py-0.5"
        :class="
          layout.activeEditorKind === 'compare' && compare.activeId === tab.id
            ? 'bg-background text-foreground ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent'
        "
        @click="compare.activeId = tab.id; layout.activeEditorKind = 'compare'"
      >
        <span class="max-w-[160px] truncate">{{ tab.title }}</span>
        <span
          class="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
          @click.stop="compare.closeTab(tab.id)"
        >
          <X class="h-3 w-3" />
        </span>
      </button>
      <button
        v-for="tab in repoAtRev.tabs"
        :key="tab.id"
        type="button"
        class="group flex items-center gap-1 rounded-sm px-2 py-0.5"
        :class="
          layout.activeEditorKind === 'repoAtRev' && repoAtRev.activeId === tab.id
            ? 'bg-background text-foreground ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent'
        "
        @click="repoAtRev.activeId = tab.id; layout.activeEditorKind = 'repoAtRev'"
      >
        <span class="max-w-[160px] truncate">{{ tab.title }}</span>
        <span
          class="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
          @click.stop="repoAtRev.closeTab(tab.id)"
        >
          <X class="h-3 w-3" />
        </span>
      </button>
      <button
        v-for="tab in conflicts.mergeTabs"
        :key="tab.id"
        type="button"
        class="group flex items-center gap-1 rounded-sm px-2 py-0.5"
        :class="
          layout.activeEditorKind === 'merge' && conflicts.activeMergeId === tab.id
            ? 'bg-background text-foreground ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent'
        "
        @click="conflicts.activeMergeId = tab.id; layout.activeEditorKind = 'merge'"
      >
        <span class="max-w-[160px] truncate">{{ tab.title }}</span>
        <span
          class="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
          @click.stop="conflicts.closeMergeTab(tab.id)"
        >
          <X class="h-3 w-3" />
        </span>
      </button>
      <button
        v-for="tab in fileViewer.tabs"
        :key="tab.id"
        type="button"
        class="group flex items-center gap-1 rounded-sm px-2 py-0.5"
        :class="
          layout.activeEditorKind === 'file' && fileViewer.activeId === tab.id
            ? 'bg-background text-foreground ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent'
        "
        @click="fileViewer.activeId = tab.id; layout.activeEditorKind = 'file'"
      >
        <span class="max-w-[160px] truncate">{{ tab.title }}</span>
        <span
          class="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
          @click.stop="fileViewer.closeTab(tab.id)"
        >
          <X class="h-3 w-3" />
        </span>
      </button>
    </div>

    <div class="min-h-0 flex-1">
      <DiffViewer
        v-if="layout.activeEditorKind === 'diff' && activeDiff"
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
        <div class="font-medium">Workspace</div>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <dt>Path</dt>
          <dd class="font-mono text-foreground">{{ workspace.folderPath }}</dd>
          <dt>Repository</dt>
          <dd>{{ workspace.isRepo ? "yes" : "no" }}</dd>
          <dt>Branch</dt>
          <dd>{{ workspace.branch?.head ?? "—" }}</dd>
          <dt>Git</dt>
          <dd class="font-mono">{{ workspace.gitVersion ?? "…" }}</dd>
        </dl>
        <EmptyState
          v-if="workspace.isRepo"
          class="!h-auto !justify-start pt-6"
          title="Ready"
          description="Commit TW for staging. Log filters / File History / Compare / Repository at Revision are in the Git tool window. Ctrl+D opens Diff (CodeMirror)."
        />
      </div>
    </div>
  </section>
</template>
