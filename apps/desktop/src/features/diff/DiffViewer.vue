<script setup lang="ts">
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import Skeleton from "@/components/common/Skeleton.vue";
import { useDiffStore } from "@/stores/diffStore";
import { useChangesStore } from "@/stores/changesStore";
import { toast } from "@/composables/useToast";
import { promptDialog } from "@/composables/useConfirm";
import type { IgnoreWhitespace } from "@/lib/backend";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import CodeMirrorDiff from "./CodeMirrorDiff.vue";
import { buildCollapsedSides, countHunkLines } from "./collapsedDiff";
import { normalizeEolForDisplay } from "./diffPaint";

const props = defineProps<{ tabId: string }>();
const diffs = useDiffStore();
const changes = useChangesStore();

type DiffPane = { applyScroll: (left: number, top: number) => void };
const leftPane = ref<DiffPane | null>(null);
const rightPane = ref<DiffPane | null>(null);

function onLeftScroll(pos: { left: number; top: number }) {
  rightPane.value?.applyScroll(pos.left, pos.top);
}
function onRightScroll(pos: { left: number; top: number }) {
  leftPane.value?.applyScroll(pos.left, pos.top);
}

const tab = computed(() => diffs.tabs.find((t) => t.id === props.tabId));
const result = computed(() => tab.value?.result);

const visibleHunks = computed(() => result.value?.hunks ?? []);

const collapsed = computed(() => {
  if (!tab.value?.collapseUnchanged || !visibleHunks.value.length) return null;
  return buildCollapsedSides(visibleHunks.value);
});

const leftText = computed(() => {
  if (collapsed.value) return collapsed.value.left.text;
  // Display uses LF so visually identical lines match; compare already normalizes EOL.
  return normalizeEolForDisplay(result.value?.leftText ?? "");
});
const rightText = computed(() => {
  if (collapsed.value) return collapsed.value.right.text;
  return normalizeEolForDisplay(result.value?.rightText ?? "");
});

const enableInline = computed(() => countHunkLines(visibleHunks.value) <= 900);

/** Forces CodeMirror remount when IPC result lands or selection changes (GIT-34). */
const paintKey = computed(
  () =>
    `${props.tabId}|e${diffs.paintEpoch}|${tab.value?.contentKey ?? ""}|${tab.value?.path ?? ""}|${tab.value?.collapseUnchanged ? "c" : "e"}|${tab.value?.unified ? "u" : "s"}`,
);

async function stageHunk(index: number) {
  if (!tab.value) return;
  await diffs.stageHunks(tab.value.path, [index]);
  toast({ title: "Hunk staged" });
  await changes.refresh();
  await diffs.openFileDiff(tab.value.path, tab.value.left, tab.value.right, { force: true });
}

async function unstageHunk(index: number) {
  if (!tab.value) return;
  await diffs.unstageHunks(tab.value.path, [index]);
  toast({ title: "Hunk unstaged" });
  await changes.refresh();
  await diffs.openFileDiff(tab.value.path, tab.value.left, tab.value.right, { force: true });
}

async function stageSelectedLines() {
  if (!tab.value || !canStage.value) return;
  const raw = await promptDialog({
    title: "Stage lines",
    message: "New-side line numbers to stage (comma or space separated)",
    allowEmpty: false,
  });
  if (raw == null || !raw.trim()) return;
  const lines = raw
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!lines.length) {
    toast({ title: "No valid line numbers" });
    return;
  }
  const { getBackend } = await import("@/lib/backend");
  const { useWorkspaceStore } = await import("@/stores/workspaceStore");
  const workspace = useWorkspaceStore();
  if (!workspace.repoPath || !workspace.repoId) return;
  await getBackend().stageLines({
    repoId: workspace.repoId,
    path: workspace.repoPath,
    filePath: tab.value.path,
    lines,
  });
  toast({ title: "Lines staged", description: `${lines.length} line(s)` });
  await changes.refresh();
  await diffs.openFileDiff(tab.value.path, tab.value.left, tab.value.right, { force: true });
}

const canStage = computed(() => tab.value?.right === "worktree" && !tab.value.leftRev);
const canUnstage = computed(
  () => tab.value?.left === "head" && tab.value?.right === "index" && !tab.value.leftRev,
);

const wsModes: { id: IgnoreWhitespace; label: string }[] = [
  { id: "none", label: "Do not ignore" },
  { id: "trim", label: "Trim whitespaces" },
  { id: "all", label: "Ignore whitespaces" },
  { id: "allAndEmptyLines", label: "Ignore whitespaces and empty lines" },
];
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col">
    <div class="flex h-8 flex-wrap items-center gap-2 border-b bg-dbx-chrome px-2 text-xs">
      <span class="font-medium">{{ tab.path }}</span>
      <span class="text-muted-foreground">
        {{ result?.leftLabel }} → {{ result?.rightLabel }}
      </span>
      <div class="flex-1" />
      <label class="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
        Whitespace
        <Select
          :model-value="tab.ignoreWhitespace"
          @update:model-value="
            (v) => {
              if (!tab) return;
              diffs.setIgnoreWhitespace(tab.id, String(v ?? 'none') as IgnoreWhitespace);
            }
          "
        >
          <SelectTrigger class="h-6 w-auto min-w-[9rem] text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="m in wsModes" :key="m.id" :value="m.id">{{ m.label }}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <Button
        size="xs"
        variant="ghost"
        @click="diffs.setCollapseUnchanged(tab.id, !tab.collapseUnchanged)"
      >
        {{ tab.collapseUnchanged ? "Expand unchanged" : "Collapse unchanged" }}
      </Button>
      <Button size="xs" variant="ghost" @click="diffs.setUnified(tab.id, !tab.unified)">
        {{ tab.unified ? "Side-by-side" : "Unified" }}
      </Button>
      <Button v-if="canStage" size="xs" variant="outline" @click="stageSelectedLines">
        Stage selected lines
      </Button>
    </div>

    <div v-if="tab.loading && !result" class="space-y-2 p-4">
      <div class="text-xs text-muted-foreground">Loading diff…</div>
      <Skeleton class="h-4 w-2/3" />
      <Skeleton class="h-4 w-1/2" />
      <Skeleton class="h-4 w-3/4" />
      <Skeleton class="mt-4 h-40 w-full" />
    </div>
    <div v-else-if="result?.binary" class="p-4 text-xs">Binary file — stage as a whole file.</div>
    <div v-else-if="result?.tooLarge" class="p-4 text-xs">
      File is too large to show —
      <button
        type="button"
        class="cursor-pointer underline"
        @click="diffs.reloadTab(tab)"
      >
        Show anyway
      </button>
    </div>
    <div v-else-if="result && !result.hunks.length" class="space-y-2 p-4 text-xs text-muted-foreground">
      <div>No differences</div>
      <div v-if="result.eolMismatch">
        Line endings differ (CRLF vs LF). Visible text matches after normalizing EOL.
      </div>
    </div>
    <div v-else-if="result" class="relative flex min-h-0 flex-1 flex-col">
      <div
        v-if="tab.loading"
        class="pointer-events-none absolute right-2 top-2 z-10 rounded-md bg-foreground/80 px-2 py-0.5 text-[10px] text-background-solid"
      >
        Refreshing…
      </div>
      <div
        v-if="result.eolMismatch"
        class="shrink-0 border-b bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground"
      >
        Line endings differ (CRLF vs LF). Visible text is compared after normalizing EOL — identical
        lines stay uncolored.
      </div>
      <div v-if="tab.unified" class="min-h-0 flex-1">
        <CodeMirrorDiff
          :key="`${paintKey}-u`"
          side="unified"
          unified
          :text="''"
          :hunks="visibleHunks"
          :paint-key="paintKey"
          :enable-inline="enableInline"
        />
      </div>
      <div v-else class="grid min-h-0 flex-1 grid-cols-2">
        <div class="min-h-0 border-r">
          <CodeMirrorDiff
            :key="`${paintKey}-L`"
            ref="leftPane"
            side="left"
            :text="leftText"
            :hunks="visibleHunks"
            :paint-key="paintKey"
            :changed-lines="collapsed?.left.changed ?? null"
            :line-map="collapsed?.left.lineMap ?? null"
            :enable-inline="enableInline"
            @scroll="onLeftScroll"
          />
        </div>
        <div class="min-h-0">
          <CodeMirrorDiff
            :key="`${paintKey}-R`"
            ref="rightPane"
            side="right"
            :text="rightText"
            :hunks="visibleHunks"
            :paint-key="paintKey"
            :changed-lines="collapsed?.right.changed ?? null"
            :line-map="collapsed?.right.lineMap ?? null"
            :enable-inline="enableInline"
            @scroll="onRightScroll"
          />
        </div>
      </div>
      <div
        v-if="canStage || canUnstage"
        class="max-h-40 shrink-0 overflow-auto border-t text-[11px]"
      >
        <div
          v-for="hunk in visibleHunks"
          :key="hunk.index"
          class="flex items-center gap-2 border-b px-2 py-1"
        >
          <span class="font-mono text-muted-foreground">{{ hunk.header }}</span>
          <div class="flex-1" />
          <Button v-if="canStage" size="xs" variant="outline" @click="stageHunk(hunk.index)">
            Stage Hunk
          </Button>
          <Button v-if="canUnstage" size="xs" variant="outline" @click="unstageHunk(hunk.index)">
            Unstage Hunk
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
