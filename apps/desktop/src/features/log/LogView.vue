<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Pane, Splitpanes } from "splitpanes";
import { Eye, Filter, Search } from "@lucide/vue";
import { useLogStore } from "@/stores/logStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useCompareStore } from "@/stores/compareStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useRepoAtRevStore } from "@/stores/repoAtRevStore";
import { useDiffStore } from "@/stores/diffStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import VirtualList from "@/components/common/VirtualList.vue";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { statusClass } from "@/features/commit/statusColor";
import type { FileChangeKind } from "@/lib/backend";
import { toast } from "@/composables/useToast";
import { confirmDialog, promptDialog } from "@/composables/useConfirm";
import { markContextHandled } from "@/lib/contextMenu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PathTreeList from "@/components/files/PathTreeList.vue";
import type { ChangedFile } from "@/lib/backend";
import BranchesPane from "@/features/branches/BranchesPane.vue";
import CommitGraphCell from "./CommitGraphCell.vue";
import { layoutCommitGraph } from "./graphLayout";

const { t } = useI18n();
const log = useLogStore();
const workspace = useWorkspaceStore();
const compare = useCompareStore();
const history = useHistoryStore();
const repoAtRev = useRepoAtRevStore();
const diffs = useDiffStore();
const layout = useLayoutStore();
const rewrite = useRewriteStore();

const ROW_H = 22;
const textDraft = ref("");
const authorDraft = ref("");
const revDraft = ref("");
const pathDraft = ref("");
const ctx = ref<{ open: boolean; x: number; y: number }>({ open: false, x: 0, y: 0 });

onMounted(() => {
  if (workspace.isRepo) void log.load(true);
});

watch(
  () => workspace.repoPath,
  () => {
    if (workspace.isRepo) void log.load(true);
  },
);

function formatTime(ts: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ts * 1000));
  } catch {
    return String(ts);
  }
}

function mapStatus(s: string): FileChangeKind {
  switch (s) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "modified";
  }
}

const graphLayout = computed(() =>
  layoutCommitGraph(log.commits, {
    filtered: !!(
      log.filters.text ||
      log.filters.authors?.length ||
      log.filters.paths?.length ||
      log.filters.since ||
      log.filters.until ||
      log.filters.noMerges
    ),
    firstParent: !!log.filters.firstParent,
  }),
);

const indexLabel = computed(() => {
  const st = log.indexStatus;
  if (!st) return "";
  if (!st.ready) return t("log.indexEmpty");
  return t("log.indexed", { count: st.commitCount });
});

function visibleRefs(refs: string[]) {
  const list = log.showTagNames ? refs : refs.filter((r) => !r.startsWith("tag:"));
  return log.compactRefs ? list.slice(0, 2) : list;
}

async function applySearch() {
  log.setTextFilter(textDraft.value);
  log.setAuthorFilter(authorDraft.value);
  log.setRevisions(revDraft.value.trim() ? [revDraft.value.trim()] : []);
  log.setPathsFilter(pathDraft.value.trim() ? [pathDraft.value.trim()] : []);
  await log.applyFilters();
}

const commitListRef = ref<{ pointerDown?: boolean } | null>(null);

function onListScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (!el) return;
  // Defer load-more while the scrollbar thumb is being dragged — appending
  // rows mid-drag changes scrollHeight and makes the thumb jam (GIT-40).
  if (commitListRef.value?.pointerDown) return;
  const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (remaining < 80) void log.loadMore();
}

function onCommitClick(sha: string, e: MouseEvent) {
  void log.select(sha, e.metaKey || e.ctrlKey);
}

function onCommitContext(sha: string, e: MouseEvent) {
  markContextHandled(e);
  if (!log.selectedShas.includes(sha)) void log.select(sha, false);
  // Placement (flip / clamp / scroll) handled by ContextMenuSurface.
  ctx.value = { open: true, x: e.clientX, y: e.clientY };
}

function closeCtx() {
  ctx.value = { ...ctx.value, open: false };
}

async function ctxCopy() {
  log.copySelectedSha();
  toast({ title: t("log.copiedRevision") });
  closeCtx();
}

async function ctxCompareLocal() {
  if (!log.selectedSha) return;
  await compare.compareWithLocal(log.selectedSha);
  closeCtx();
}

async function ctxCompareVersions() {
  if (log.selectedShas.length < 2) {
    toast({ title: t("log.selectTwoCommits") });
    return;
  }
  await compare.compareVersions(log.selectedShas[0]!, log.selectedShas[1]!);
  closeCtx();
}

async function ctxRepoAtRev() {
  if (!log.selectedSha) return;
  await repoAtRev.open(log.selectedSha);
  closeCtx();
}

async function ctxCombined() {
  if (!log.selectedSha) return;
  const tab = await (async () => {
    await compare.compareVersions(log.selectedSha!, `${log.selectedSha}^`);
    const t = compare.tabs.find((x) => x.left === log.selectedSha || x.right === log.selectedSha);
    if (t) await compare.showCombined(t);
    return t;
  })();
  if (tab) layout.activeEditorKind = "compare";
  closeCtx();
}

async function openChangedFile(path: string, origPath: string | null) {
  if (!log.selectedSha) return;
  await diffs.openRevDiff(path, `${log.selectedSha}^`, log.selectedSha, origPath ?? undefined);
  layout.activeEditorKind = "diff";
}

async function showFileHistory(path: string) {
  await history.openFileHistory(path);
}

async function ctxCherryPick() {
  const shas = log.selectedShas.length
    ? [...log.selectedShas]
    : log.selectedSha
      ? [log.selectedSha]
      : [];
  if (!shas.length) return;
  closeCtx();
  await rewrite.cherryPick({ shas });
}

async function ctxReword() {
  if (!log.selectedSha) return;
  closeCtx();
  const { openDialog } = await import("@/composables/useDialog");
  const RewordDialog = (await import("@/features/merge/RewordDialog.vue")).default;
  await openDialog(RewordDialog, { sha: log.selectedSha });
}

async function ctxInteractive() {
  if (!log.selectedSha) return;
  closeCtx();
  const { openDialog } = await import("@/composables/useDialog");
  const InteractiveRebaseEditor = (await import("@/features/merge/InteractiveRebaseEditor.vue"))
    .default;
  await openDialog(InteractiveRebaseEditor, { fromSha: log.selectedSha });
}

async function ctxReset() {
  if (!log.selectedSha) return;
  closeCtx();
  const { openDialog } = await import("@/composables/useDialog");
  const ResetDialog = (await import("@/features/merge/ResetDialog.vue")).default;
  await openDialog(ResetDialog, { target: log.selectedSha });
}

async function ctxRevert() {
  const shas = log.selectedShas.length
    ? [...log.selectedShas]
    : log.selectedSha
      ? [log.selectedSha]
      : [];
  if (!shas.length) return;
  closeCtx();
  await rewrite.revert(shas);
}

async function ctxDrop() {
  const shas = log.selectedShas.length
    ? [...log.selectedShas]
    : log.selectedSha
      ? [log.selectedSha]
      : [];
  if (!shas.length) return;
  closeCtx();
  const ok = await confirmDialog({
    title: t("actions.dropCommits"),
    message: t("log.dropConfirm", { count: shas.length }),
    destructive: true,
  });
  if (!ok) return;
  await rewrite.drop(shas);
}

async function ctxSquash() {
  const shas = log.selectedShas.length ? [...log.selectedShas] : [];
  if (shas.length < 2) {
    toast({ title: t("log.selectTwoOrMore") });
    return;
  }
  closeCtx();
  const { openDialog } = await import("@/composables/useDialog");
  const SquashDialog = (await import("@/features/merge/SquashDialog.vue")).default;
  await openDialog(SquashDialog, { shas });
}

async function ctxUncommit() {
  closeCtx();
  await rewrite.uncommit();
}

async function ctxExtract() {
  if (!log.selectedSha || !log.changedFiles.length) return;
  closeCtx();
  const paths = log.changedFiles.map((f) => f.path);
  const msg = await promptDialog({
    title: t("actions.extractSelected"),
    defaultValue: t("log.extractedDefault"),
  });
  if (msg == null) return;
  await rewrite.extractChanges(log.selectedSha, paths, msg || t("log.extractedDefault"));
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background" @click="closeCtx">
    <EmptyState
      v-if="!workspace.isRepo"
      :title="t('log.noRepoTitle')"
      :description="t('log.noRepoHint')"
    />
    <ErrorState v-else-if="log.error" :title="t('log.failed')" :message="log.error" />
    <template v-else>
      <div class="flex flex-wrap items-center gap-1 border-b bg-dbx-chrome px-2 py-1 text-[11px]">
        <Filter class="h-3.5 w-3.5 text-muted-foreground" />
        <input
          v-model="textDraft"
          class="h-6 w-36 rounded border bg-background px-1.5"
          :placeholder="t('log.searchPlaceholder')"
          @keydown.enter="applySearch"
        />
        <input
          v-model="authorDraft"
          class="h-6 w-24 rounded border bg-background px-1.5"
          :placeholder="t('log.userPlaceholder')"
          @keydown.enter="applySearch"
        />
        <input
          v-model="revDraft"
          class="h-6 w-28 rounded border bg-background px-1.5"
          :placeholder="t('log.branchPlaceholder')"
          @keydown.enter="applySearch"
        />
        <input
          v-model="pathDraft"
          class="h-6 w-28 rounded border bg-background px-1.5"
          :placeholder="t('log.pathsPlaceholder')"
          @keydown.enter="applySearch"
        />
        <Select
          model-value="all"
          @update:model-value="
            (v) => {
              log.setDatePreset(String(v ?? 'all') as '24h' | '7d' | 'all');
              applySearch();
            }
          "
        >
          <SelectTrigger class="h-6 w-auto min-w-[6.5rem] text-[11px]">
            <SelectValue :placeholder="t('log.anyDate')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t("log.anyDate") }}</SelectItem>
            <SelectItem value="24h">{{ t("log.last24h") }}</SelectItem>
            <SelectItem value="7d">{{ t("log.last7d") }}</SelectItem>
          </SelectContent>
        </Select>
        <Tip :text="t('log.applyTip')">
          <Button size="xs" variant="secondary" @click="applySearch">{{
            t("common.apply")
          }}</Button>
        </Tip>
        <Tip :text="t('log.clearTip')">
          <Button
            size="xs"
            variant="ghost"
            @click="
              log.clearAllFilters();
              applySearch();
            "
          >
            {{ t("log.clear") }}
          </Button>
        </Tip>
        <div class="mx-1 h-4 w-px bg-border" />
        <Tip :text="t('log.graphTip')">
          <Button
            size="xs"
            variant="ghost"
            :class="log.showGraphOptions ? 'bg-accent' : ''"
            @click="log.showGraphOptions = !log.showGraphOptions"
          >
            <Eye class="mr-1 h-3 w-3" />
            {{ t("log.graph") }}
          </Button>
        </Tip>
        <div class="flex flex-1 items-center gap-1">
          <Search class="h-3.5 w-3.5 text-muted-foreground" />
          <input
            v-model="log.goToInput"
            class="h-6 min-w-[8rem] flex-1 rounded border bg-background px-1.5"
            :placeholder="t('log.goToPlaceholder')"
            @keydown.enter="log.goToHashOrRef()"
          />
        </div>
        <span v-if="indexLabel" class="truncate text-muted-foreground" :title="indexLabel">
          {{ indexLabel }}
        </span>
        <Tip :text="t('log.rebuildIndexTip')">
          <Button size="xs" variant="ghost" @click="log.rebuildIndex()">
            {{ t("log.rebuildIndex") }}
          </Button>
        </Tip>
      </div>

      <div
        v-if="log.showGraphOptions"
        class="flex flex-wrap items-center gap-2 border-b px-2 py-1 text-[11px]"
      >
        <label class="flex items-center gap-1">
          {{ t("log.sort") }}
          <Select
            :model-value="log.filters.order ?? 'date'"
            @update:model-value="
              (v) => {
                log.setOrder(String(v ?? 'date') as 'date' | 'topo');
                applySearch();
              }
            "
          >
            <SelectTrigger class="h-6 w-auto min-w-[6rem] text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">{{ t("log.sortDate") }}</SelectItem>
              <SelectItem value="topo">{{ t("log.sortTopo") }}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label class="flex items-center gap-1">
          <input
            type="checkbox"
            :checked="!!log.filters.firstParent"
            @change="
              log.toggleFirstParent();
              applySearch();
            "
          />
          {{ t("log.firstParent") }}
        </label>
        <label class="flex items-center gap-1">
          <input
            type="checkbox"
            :checked="!!log.filters.noMerges"
            @change="
              log.toggleNoMerges();
              applySearch();
            "
          />
          {{ t("log.noMerges") }}
        </label>
        <label class="flex items-center gap-1">
          <input v-model="log.compactRefs" type="checkbox" />
          {{ t("log.compactRefs") }}
        </label>
        <label class="flex items-center gap-1">
          <input v-model="log.showTagNames" type="checkbox" />
          {{ t("log.tagNames") }}
        </label>
      </div>

      <div v-if="log.activeFilterChips.length" class="flex flex-wrap gap-1 border-b px-2 py-1">
        <button
          v-for="chip in log.activeFilterChips"
          :key="chip.key"
          type="button"
          class="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] hover:bg-accent"
          @click="
            log.clearFilter(chip.key);
            applySearch();
          "
        >
          {{ chip.label }} ×
        </button>
      </div>

      <Splitpanes class="min-h-0 flex-1">
        <Pane :size="18" min-size="12" max-size="36">
          <BranchesPane />
        </Pane>
        <Pane :size="82" min-size="40">
          <EmptyState
            v-if="!log.loading && !log.commits.length"
            :title="t('log.noMatchesTitle')"
            :description="t('log.noMatchesHint')"
          />
          <Splitpanes v-else class="h-full min-h-0">
            <Pane :size="58" min-size="30">
              <div class="flex h-full min-h-0 flex-col">
                <div
                  class="grid h-7 shrink-0 items-center border-b px-2 text-[11px] text-muted-foreground"
                  :style="{
                    gridTemplateColumns: `${graphLayout.colPx}px 1fr 120px 140px`,
                  }"
                >
                  <span>{{ t("log.colGraph") }}</span>
                  <span>{{ t("log.colMessage") }}</span>
                  <span>{{ t("log.colAuthor") }}</span>
                  <span>{{ t("log.colDate") }}</span>
                </div>
                <VirtualList
                  ref="commitListRef"
                  :items="log.commits"
                  :item-height="ROW_H"
                  :get-key="(c) => c.sha"
                  @scroll="onListScroll"
                >
                  <template #default="{ item: c, index: idx }">
                    <button
                      type="button"
                      class="grid h-[22px] w-full items-center px-2 text-left text-[12.5px]"
                      :style="{
                        gridTemplateColumns: `${graphLayout.colPx}px 1fr 120px 140px`,
                      }"
                      :class="
                        log.selectedShas.includes(c.sha)
                          ? 'bg-selection text-selection-foreground'
                          : 'hover:bg-hover-surface'
                      "
                      @click="onCommitClick(c.sha, $event)"
                      @contextmenu="onCommitContext(c.sha, $event)"
                    >
                      <span class="flex h-full items-center justify-start">
                        <CommitGraphCell
                          :graph="graphLayout.rows[idx]!.graph"
                          :edge-colors="graphLayout.rows[idx]!.edgeColors"
                          :incoming="graphLayout.rows[idx]!.incoming"
                          :hidden-parents="graphLayout.rows[idx]!.hiddenParents"
                          :max-lane="graphLayout.maxLane"
                          :lane-labels="graphLayout.rows[idx]!.laneLabels"
                          :node-label="graphLayout.rows[idx]!.nodeLabel"
                          :lane-width="14"
                        />
                      </span>
                      <span class="flex min-w-0 items-center gap-1 truncate">
                        <span
                          v-for="refName in visibleRefs(c.refs)"
                          :key="refName"
                          class="shrink-0 rounded-sm bg-muted px-1 text-[10px] text-foreground"
                        >
                          {{ refName }}
                        </span>
                        <span class="truncate">{{ c.subject }}</span>
                      </span>
                      <span class="truncate text-muted-foreground">{{ c.author }}</span>
                      <span class="truncate text-muted-foreground">{{
                        formatTime(c.authorTime)
                      }}</span>
                    </button>
                  </template>
                  <template #footer>
                    <div
                      v-if="log.truncated || log.loadingMore"
                      class="flex w-full items-center justify-center py-2 text-xs text-muted-foreground"
                    >
                      <span v-if="log.loadingMore">{{ t("log.loadingMore") }}</span>
                      <button
                        v-else
                        type="button"
                        class="hover:text-foreground"
                        @click="log.loadMore()"
                      >
                        {{ t("log.loadMore") }}
                      </button>
                    </div>
                  </template>
                </VirtualList>
              </div>
            </Pane>
            <Pane :size="42" min-size="24">
              <Splitpanes horizontal class="h-full">
                <Pane :size="45">
                  <div class="flex h-full min-h-0 flex-col">
                    <div class="border-b px-2 py-1 text-[11px] font-medium">
                      {{ t("log.changedFiles") }}
                    </div>
                    <PathTreeList
                      :files="log.changedFiles"
                      :status-class="(f: ChangedFile) => statusClass(mapStatus(f.status))"
                      empty-text=""
                      @open="(f) => openChangedFile(f.path, f.origPath)"
                      @context="({ file }) => showFileHistory(file.path)"
                    />
                  </div>
                </Pane>
                <Pane :size="55">
                  <div v-if="log.details" class="h-full overflow-auto p-2 text-[12px]">
                    <div class="font-mono text-[11px] text-muted-foreground">
                      {{ log.details.sha }}
                    </div>
                    <div class="mt-1 font-medium">{{ log.details.subject }}</div>
                    <pre
                      v-if="log.details.body"
                      class="mt-1 whitespace-pre-wrap font-sans text-muted-foreground"
                      >{{ log.details.body }}</pre
                    >
                    <dl
                      class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
                    >
                      <dt>{{ t("log.author") }}</dt>
                      <dd>
                        {{ log.details.author }} &lt;{{ log.details.authorEmail }}&gt;
                      </dd>
                      <dt>{{ t("log.date") }}</dt>
                      <dd>{{ formatTime(log.details.authorTime) }}</dd>
                      <dt>{{ t("log.parents") }}</dt>
                      <dd class="font-mono">
                        {{ log.details.parents.map((p) => p.slice(0, 7)).join(", ") || "—" }}
                      </dd>
                    </dl>
                  </div>
                </Pane>
              </Splitpanes>
            </Pane>
          </Splitpanes>
        </Pane>
      </Splitpanes>
    </template>

    <ContextMenuSurface
      :open="ctx.open"
      :anchor-x="ctx.x"
      :anchor-y="ctx.y"
      :width="260"
      :estimated-height="420"
      @close="closeCtx"
    >
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxCopy"
      >
        {{ t("log.copyRevision") }}
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxCherryPick"
      >
        {{ t("actions.cherryPick") }}
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxReword"
      >
        {{ t("actions.reword") }}
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxInteractive"
      >
        {{ t("actions.interactiveRebase") }}
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxSquash"
      >
        {{ t("actions.squash") }}
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxDrop"
      >
        {{ t("actions.dropCommits") }}
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxUncommit"
      >
        {{ t("actions.uncommit") }}
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxRevert"
      >
        {{ t("actions.revert") }}
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxReset"
      >
        {{ t("actions.reset") }}
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxExtract"
      >
        {{ t("actions.extractSelected") }}
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxCompareLocal"
      >
        {{ t("history.compareWithLocal") }}
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxCompareVersions"
      >
        {{ t("history.compareVersions") }}
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxCombined"
      >
        {{ t("history.showAllChanges") }}
      </button>
      <button
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
        @click="ctxRepoAtRev"
      >
        {{ t("history.repoAtRevision") }}
      </button>
    </ContextMenuSurface>
  </div>
</template>
