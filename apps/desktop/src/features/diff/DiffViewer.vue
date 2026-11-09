<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import Skeleton from "@/components/common/Skeleton.vue";
import { useDiffStore } from "@/stores/diffStore";
import { useChangesStore } from "@/stores/changesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { getBackend } from "@/lib/backend";
import { formatErrorMessage } from "@/lib/errors";
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
import { expandUnifiedHunks } from "./expandedDiff";

const props = defineProps<{ tabId: string }>();
const { t } = useI18n();
const diffs = useDiffStore();
const changes = useChangesStore();
const workspace = useWorkspaceStore();

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
const waitingForTexts = computed(() =>
  !tab.value?.collapseUnchanged && !tab.value?.textsLoaded &&
  !result.value?.binary && !result.value?.tooLarge,
);
const unifiedHunks = computed(() => tab.value?.collapseUnchanged
  ? visibleHunks.value
  : expandUnifiedHunks(visibleHunks.value, result.value?.leftText ?? "", result.value?.rightText ?? ""),
);

const collapsed = computed(() => {
  if (!tab.value?.collapseUnchanged || !visibleHunks.value.length) return null;
  return buildCollapsedSides(visibleHunks.value);
});

const leftText = computed(() => {
  if (collapsed.value) return collapsed.value.left.text;
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

function localizeSideLabel(label: string | undefined): string {
  if (!label) return "";
  switch (label) {
    case "Staged":
      return t("diff.sideStaged");
    case "Local":
      return t("diff.sideLocal");
    case "HEAD":
      return t("diff.sideHead");
    default:
      return label;
  }
}

const sideSummary = computed(
  () =>
    `${localizeSideLabel(result.value?.leftLabel)} → ${localizeSideLabel(result.value?.rightLabel)}`,
);

const wsModes: { id: IgnoreWhitespace; key: string }[] = [
  { id: "none", key: "diff.wsNone" },
  { id: "trim", key: "diff.wsTrim" },
  { id: "all", key: "diff.wsAll" },
  { id: "allAndEmptyLines", key: "diff.wsAllAndEmpty" },
];

function wsLabel(id: IgnoreWhitespace | undefined): string {
  const mode = wsModes.find((m) => m.id === id) ?? wsModes[0]!;
  return t(mode.key);
}

const stagingLines = ref(false);
let stageGeneration = 0;
let previewGeneration = 0;
// Synchronous invalidation also catches A → B → A navigation in one tick.
watch(
  () => [
    workspace.repoId, workspace.repoPath, props.tabId, diffs.activeId,
    tab.value?.path, tab.value?.left, tab.value?.right,
    tab.value?.leftRev, tab.value?.rightRev, tab.value?.leftPath,
  ],
  () => { stageGeneration += 1; },
  { flush: "sync" },
);
watch(
  () => [tab.value?.result, tab.value?.loading, tab.value?.ignoreWhitespace],
  () => { previewGeneration += 1; },
  { flush: "sync" },
);
onBeforeUnmount(() => { stageGeneration += 1; });

const canStage = computed(() =>
  tab.value?.kind === "file" && tab.value.left === "index" &&
  tab.value.right === "worktree" && !tab.value.leftRev && !tab.value.rightRev &&
  (!tab.value.leftPath || tab.value.leftPath === tab.value.path) &&
  !tab.value.loading && !tab.value.error && !!result.value?.hunks.length &&
  !result.value.binary && !result.value.tooLarge,
);

async function stageSelectedLines() {
  if (!tab.value || !canStage.value || stagingLines.value) return;
  const { repoId, repoPath } = workspace;
  if (!repoId || !repoPath) return;
  const { id, path } = tab.value;
  const generation = stageGeneration;
  const preview = previewGeneration;
  const current = () => stageGeneration === generation;
  stagingLines.value = true;
  let staged = false;
  try {
    const raw = await promptDialog({
      title: t("diff.stageLinesTitle"),
      message: t("diff.stageLinesPrompt"),
      allowEmpty: false,
    });
    if (!current() || preview !== previewGeneration || raw == null || !raw.trim()) return;
    const tokens = raw.trim().split(/[,\s]+/);
    const lines = [...new Set(tokens.map(Number))];
    if (tokens.some((s) => !/^\d+$/.test(s)) ||
        lines.some((n) => !Number.isInteger(n) || n <= 0 || n > 0xffffffff)) {
      toast({ title: t("diff.noValidLines") });
      return;
    }
    await getBackend().stageLines({ repoId, path: repoPath, filePath: path, lines });
    staged = true;
    if (!current()) return;
    toast({
      title: t("diff.linesStaged"),
      description: t("diff.linesStagedCount", { count: lines.length }),
    });
    await changes.refresh();
    if (current()) await diffs.reloadTab(id);
  } catch (error) {
    if (current()) toast({
      title: t(staged ? "diff.stagedRefreshFailed" : "diff.stageLinesFailed"),
      description: formatErrorMessage(error),
      persistent: true,
    });
  } finally {
    stagingLines.value = false;
  }
}
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col">
    <div class="flex h-8 flex-wrap items-center gap-2 border-b bg-dbx-chrome px-2 text-xs">
      <span class="font-medium">
        <template v-if="tab.leftPath && tab.leftPath !== tab.path">{{ tab.leftPath }} → </template>
        {{ tab.path }}
      </span>
      <span class="text-muted-foreground">{{ sideSummary }}</span>
      <div class="flex-1" />
      <Tip :text="t('toolbar.diffWhitespace')">
        <label
          class="flex cursor-pointer items-center gap-1 text-[11px] leading-4 text-muted-foreground"
        >
          {{ t("diff.whitespace") }}
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
              <SelectValue>{{ wsLabel(tab.ignoreWhitespace) }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="m in wsModes" :key="m.id" :value="m.id">
                {{ t(m.key) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
      </Tip>
      <Tip :text="t('toolbar.diffCollapse')">
        <Button
          size="xs"
          variant="ghost"
          @click="diffs.setCollapseUnchanged(tab.id, !tab.collapseUnchanged)"
        >
          {{ tab.collapseUnchanged ? t("diff.expandUnchanged") : t("diff.collapseUnchanged") }}
        </Button>
      </Tip>
      <Tip :text="t('toolbar.diffLayoutTip')">
        <Button size="xs" variant="ghost" @click="diffs.setUnified(tab.id, !tab.unified)">
          {{ tab.unified ? t("diff.sideBySide") : t("diff.unified") }}
        </Button>
      </Tip>
      <Tip v-if="canStage" :text="t('toolbar.diffStageLines')">
        <Button size="xs" variant="outline" :disabled="stagingLines" @click="stageSelectedLines">
          {{ t("diff.stageSelectedLines") }}
        </Button>
      </Tip>
    </div>

    <div v-if="tab.error" class="space-y-2 border-b p-3 text-xs" role="alert">
      <div>{{ t("diff.loadFailed") }}: {{ tab.error }}</div>
      <Button size="xs" variant="outline" :disabled="tab.loading" @click="diffs.reloadTab(tab.id)">
        {{ t("diff.retry") }}
      </Button>
    </div>
    <div v-if="tab.loading && (!result || waitingForTexts)" class="space-y-2 p-4">
      <div class="text-xs text-muted-foreground">{{ t("diff.loading") }}</div>
      <Skeleton class="h-4 w-2/3" />
      <Skeleton class="h-4 w-1/2" />
      <Skeleton class="h-4 w-3/4" />
      <Skeleton class="mt-4 h-40 w-full" />
    </div>
    <div v-else-if="result?.binary" class="p-4 text-xs">{{ t("diff.binary") }}</div>
    <div v-else-if="result?.tooLarge" class="p-4 text-xs">
      {{ t("diff.tooLarge") }}
      <button type="button" class="cursor-pointer underline" @click="diffs.reloadTab(tab)">
        {{ t("diff.showAnyway") }}
      </button>
    </div>
    <div
      v-else-if="result && !result.hunks.length && tab.collapseUnchanged"
      class="space-y-2 p-4 text-xs leading-5 text-muted-foreground"
    >
      <div>{{ t("diff.noDifferences") }}</div>
      <div v-if="result.eolMismatch">{{ t("diff.eolMismatchShort") }}</div>
    </div>
    <div v-else-if="result && !waitingForTexts" class="relative flex min-h-0 flex-1 flex-col">
      <div v-if="!result.hunks.length" class="shrink-0 border-b px-3 py-1.5 text-xs text-muted-foreground">
        {{ t("diff.noDifferences") }}
      </div>
      <div
        v-if="tab.loading"
        class="pointer-events-none absolute right-2 top-2 z-10 rounded-md bg-foreground/80 px-2 py-0.5 text-[10px] leading-4 text-background-solid"
      >
        {{ t("diff.refreshing") }}
      </div>
      <!-- Single bound string + explicit leading: avoids WebView double-paint of split text nodes. -->
      <div
        v-if="result.eolMismatch"
        class="block shrink-0 border-b bg-muted/60 px-3 py-1.5 text-[11px] leading-5 text-muted-foreground"
        role="status"
      >
        {{ t("diff.eolMismatch") }}
      </div>
      <div v-if="tab.unified" class="min-h-0 flex-1">
        <CodeMirrorDiff
          :key="`${paintKey}-u`"
          side="unified"
          unified
          :text="''"
          :hunks="unifiedHunks"
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
    </div>
  </div>
</template>
