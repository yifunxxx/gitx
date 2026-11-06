<script setup lang="ts">
import { onMounted, watch } from "vue";
import { Plus, Minus, RefreshCw, FileDiff } from "@lucide/vue";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import Skeleton from "@/components/common/Skeleton.vue";
import { Button } from "@/components/ui/button";
import ChangesTree from "@/features/commit/ChangesTree.vue";
import CommitMessageEditor from "@/features/commit/CommitMessageEditor.vue";
import RepoStateBanner from "@/features/merge/RepoStateBanner.vue";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore, type ChangesSection } from "@/stores/changesStore";
import { useDiffStore } from "@/stores/diffStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { toast } from "@/composables/useToast";

const workspace = useWorkspaceStore();
const changes = useChangesStore();
const diffs = useDiffStore();
const layout = useLayoutStore();
const rewrite = useRewriteStore();

onMounted(() => {
  if (workspace.isRepo) {
    void changes.refresh();
    void rewrite.refreshOpState();
  }
});

watch(
  () => workspace.repoPath,
  () => {
    if (workspace.isRepo) {
      void changes.refresh();
      void rewrite.refreshOpState();
    }
  },
);

async function enableVcs() {
  await workspace.enableVcs("main");
  toast({ title: "Git enabled", description: "Repository initialized" });
  await changes.refresh();
}

function openDiff(path: string, section: ChangesSection) {
  if (section === "staged") {
    void diffs.openFileDiff(path, "head", "index");
  } else {
    void diffs.openFileDiff(path, "index", "worktree");
  }
}

async function stageSelected() {
  const paths = changes.selectedPaths;
  if (!paths.length) return;
  if (changes.selectedSection === "unversioned") {
    await changes.add(paths);
  } else {
    await changes.stage(paths);
  }
  toast({ title: "Staged", description: `${paths.length} path(s)` });
}

async function unstageSelected() {
  const paths = changes.selectedPaths;
  if (!paths.length) return;
  await changes.unstage(paths);
  toast({ title: "Unstaged", description: `${paths.length} path(s)` });
}

async function stageAll() {
  const paths = [
    ...changes.unstaged.map((f) => f.path),
    ...changes.unversioned.map((f) => f.path),
  ];
  if (!paths.length) return;
  await changes.stage(paths);
  toast({ title: "Staged all" });
}

function showDiffSelected() {
  const path = changes.selectedPaths[0];
  if (!path || !changes.selectedSection) return;
  openDiff(path, changes.selectedSection);
}

function onContext(payload: { path: string; section: ChangesSection; x: number; y: number }) {
  layout.vcsPopupOpen = false;
  // Lightweight inline context via toast actions for M1; full CustomContextMenu wiring later.
  void payload;
  if (payload.section === "staged") {
    void unstageSelected();
  } else {
    void stageSelected();
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-sidebar">
    <div class="flex h-8 items-center justify-between border-b px-2 text-xs font-medium">
      <span>Commit</span>
      <div class="flex items-center gap-0.5">
        <Button variant="ghost" size="icon" title="Refresh" @click="changes.refresh()">
          <RefreshCw class="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" title="Show Diff" @click="showDiffSelected">
          <FileDiff class="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" title="Stage" @click="stageSelected">
          <Plus class="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" title="Unstage" @click="unstageSelected">
          <Minus class="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="xs" @click="stageAll">Stage All</Button>
      </div>
    </div>

    <EmptyState
      v-if="!workspace.folderPath"
      title="No folder open"
      description="Open a folder from Welcome or the toolbar."
    />
    <EmptyState
      v-else-if="!workspace.isRepo"
      title="This folder is not under version control"
      description="Enable Version Control Integration to create a Git repository here."
    >
      <Button size="sm" @click="enableVcs">Enable Version Control Integration…</Button>
    </EmptyState>
    <ErrorState v-else-if="changes.error" message="Failed to refresh status" :title="changes.error">
      <Button size="sm" variant="outline" @click="changes.refresh()">Retry</Button>
    </ErrorState>
    <template v-else>
      <RepoStateBanner />
      <div v-if="changes.loading && !changes.snapshot" class="space-y-2 p-2">
        <Skeleton class="h-4 w-2/3" />
        <Skeleton class="h-4 w-1/2" />
        <Skeleton class="h-4 w-3/4" />
      </div>
      <ChangesTree v-else @open-diff="openDiff" @context="onContext" />
      <CommitMessageEditor />
    </template>
  </div>
</template>
