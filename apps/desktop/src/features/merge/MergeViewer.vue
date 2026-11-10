<script setup lang="ts">
import { computed, markRaw, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import { ChevronUp, ChevronDown, Undo2, Redo2 } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { useConflictsStore } from "@/stores/conflictsStore";
import { parseSource, sourceExtensions } from "@/components/common/preservedText";
import MergeTextPane from "./MergeTextPane.vue";
import { resultHighlights, sourceDecorations } from "./mergeDecorations";
import {
  mergeRanges,
  mergeViewConfig,
  decideMergeSide,
  decideAllMergeSide,
  confirmManualRange,
  pendingMergeCount,
  sourceBlockPositions,
  rangePending,
  type MergeSide,
} from "./mergeDocument";

const conflicts = useConflictsStore();
const { t } = useI18n();
const tab = computed(
  () => conflicts.mergeTabs.find((item) => item.id === conflicts.activeMergeId) ?? null,
);
const ranges = computed(() => tab.value?.mergeState.field(mergeRanges) ?? []);
const remaining = computed(() => (tab.value ? pendingMergeCount(tab.value.mergeState) : 0));
const selected = ref<number | null>(null);
const active = computed(() => ranges.value.find((range) => range.index === selected.value));
const ordinal = computed(
  () => ranges.value.findIndex((range) => range.index === selected.value) + 1,
);
type Pane = { getView: () => EditorView | undefined };
const left = ref<Pane | null>(null);
const result = ref<Pane | null>(null);
const right = ref<Pane | null>(null);
watch(
  () => tab.value?.id,
  () => {
    selected.value = ranges.value.find(rangePending)?.index ?? ranges.value[0]?.index ?? null;
  },
  { immediate: true },
);

function sourceState(side: MergeSide) {
  const text =
    tab.value?.merge3?.blocks
      .map((block) => (side === "ours" ? block.oursLines : block.theirsLines).join(""))
      .join("") ?? "";
  const parsed = parseSource(text);
  return markRaw(
    EditorState.create({
      doc: parsed.doc,
      extensions: [sourceExtensions(parsed), mergeViewConfig.of([])],
    }),
  );
}
const leftState = computed(() => sourceState("ours"));
const rightState = computed(() => sourceState("theirs"));
const leftPositions = computed(() =>
  tab.value?.merge3 ? sourceBlockPositions(tab.value.merge3, "ours") : [],
);
const rightPositions = computed(() =>
  tab.value?.merge3 ? sourceBlockPositions(tab.value.merge3, "theirs") : [],
);
function label(index: number, side: MergeSide, choice: "accept" | "ignore") {
  const number = ranges.value.findIndex((range) => range.index === index) + 1;
  return t(choice === "accept" ? "merge.takeBlock" : "merge.ignoreBlock", {
    index: number,
    side: t(side === "ours" ? "merge.leftSide" : "merge.rightSide"),
  });
}
const leftDecorations = computed(() =>
  sourceDecorations(
    leftState.value,
    leftPositions.value,
    ranges.value,
    "ours",
    !!tab.value?.saving,
    label,
    choose,
  ),
);
const rightDecorations = computed(() =>
  sourceDecorations(
    rightState.value,
    rightPositions.value,
    ranges.value,
    "theirs",
    !!tab.value?.saving,
    label,
    choose,
  ),
);
function updateState(id: string, state: EditorState, docChanged: boolean) {
  const current = conflicts.mergeTabs.find((item) => item.id === id);
  if (!current || current.saving) return;
  if (id === tab.value?.id && (docChanged || state.selection !== current.mergeState.selection)) {
    const head = state.selection.main.head;
    const at = state.field(mergeRanges).find((range) => head >= range.from && head <= range.to);
    if (at) selected.value = at.index;
  }
  // Selection/scroll only retain state and never serialize the document.
  if (docChanged || state.field(mergeRanges) !== current.mergeState.field(mergeRanges))
    conflicts.updateMergeState(current.id, state);
  else current.mergeState = markRaw(state);
}
function scrollTo(pane: Pane | null, position: number) {
  const view = pane?.getView();
  if (view)
    view.dispatch({
      effects: EditorView.scrollIntoView(Math.min(position, view.state.doc.length), {
        y: "center",
      }),
    });
}
function reveal(index: number) {
  selected.value = index;
  const range = ranges.value.find((r) => r.index === index);
  if (!range) return;
  scrollTo(left.value, leftPositions.value[index]?.from ?? 0);
  scrollTo(result.value, range.from);
  scrollTo(right.value, rightPositions.value[index]?.from ?? 0);
}
async function choose(index: number, side: MergeSide, choice: "accept" | "ignore") {
  const current = tab.value,
    view = result.value?.getView();
  if (!current?.merge3 || current.saving || !view) return;
  const spec = decideMergeSide(view.state, current.merge3, index, side, choice);
  if (!spec) return;
  view.dispatch(spec);
  await nextTick();
  if (tab.value?.id !== current.id) return;
  reveal(index);
  view.focus();
}
function acceptAll(side: MergeSide) {
  const current = tab.value,
    view = result.value?.getView();
  if (!current?.merge3 || current.saving || !view) return;
  const spec = decideAllMergeSide(view.state, current.merge3, side);
  if (spec) view.dispatch(spec);
  view.focus();
}
function keepManual() {
  const view = result.value?.getView();
  if (!view || selected.value === null || tab.value?.saving) return;
  const spec = confirmManualRange(view.state, selected.value);
  if (spec) view.dispatch(spec);
  view.focus();
}
function navigate(direction: number) {
  const index = Math.max(0, Math.min(ranges.value.length - 1, ordinal.value - 1 + direction));
  const target = ranges.value[index];
  if (target) reveal(target.index);
}
function navigationKey(event: KeyboardEvent) {
  if (
    event.key !== "F7" ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.isComposing ||
    event.repeat
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  navigate(event.shiftKey ? -1 : 1);
}
function historyAction(forward: boolean) {
  const view = result.value?.getView();
  if (!view || tab.value?.saving) return;
  (forward ? redo : undo)(view);
  view.focus();
}
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col" @keydown="navigationKey">
    <div class="flex min-h-9 flex-wrap items-center gap-2 border-b bg-dbx-chrome px-2 py-1 text-xs">
      <span class="max-w-48 truncate font-medium" :title="tab.title">{{ tab.title }}</span>
      <span role="status" class="text-muted-foreground">{{
        t("merge.remaining", { count: remaining })
      }}</span>
      <div class="flex items-center gap-0.5">
        <Button
          size="xs"
          variant="ghost"
          :title="t('merge.previousConflict')"
          :aria-label="t('merge.previousConflict')"
          :disabled="ordinal <= 1"
          @click="navigate(-1)"
          ><ChevronUp class="size-3.5"
        /></Button>
        <span class="min-w-9 text-center tabular-nums">{{ ordinal }}/{{ ranges.length }}</span>
        <Button
          size="xs"
          variant="ghost"
          :title="t('merge.nextConflict')"
          :aria-label="t('merge.nextConflict')"
          :disabled="!ordinal || ordinal >= ranges.length"
          @click="navigate(1)"
          ><ChevronDown class="size-3.5"
        /></Button>
        <Button
          size="xs"
          variant="ghost"
          :title="t('merge.undo')"
          :aria-label="t('merge.undo')"
          :disabled="tab.saving || !undoDepth(tab.mergeState)"
          @click="historyAction(false)"
          ><Undo2 class="size-3.5"
        /></Button>
        <Button
          size="xs"
          variant="ghost"
          :title="t('merge.redo')"
          :aria-label="t('merge.redo')"
          :disabled="tab.saving || !redoDepth(tab.mergeState)"
          @click="historyAction(true)"
          ><Redo2 class="size-3.5"
        /></Button>
      </div>
      <div class="ml-auto flex flex-wrap gap-1">
        <Button
          size="xs"
          variant="outline"
          :disabled="tab.saving || !remaining"
          @click="acceptAll('ours')"
          >{{ t("merge.acceptLeft") }}</Button
        >
        <Button
          size="xs"
          variant="outline"
          :disabled="tab.saving || !remaining"
          @click="acceptAll('theirs')"
          >{{ t("merge.acceptRight") }}</Button
        >
        <Button
          size="xs"
          :disabled="tab.saving || remaining > 0"
          @click="conflicts.applyMergeResult(tab.id)"
          >{{ t(tab.saving ? "merge.saving" : "merge.saveResolved") }}</Button
        >
      </div>
    </div>
    <p v-if="tab.error" role="alert" class="border-b px-2 py-1 text-xs text-destructive">
      {{ tab.error }}
    </p>
    <div
      class="flex flex-wrap items-center gap-2 border-b px-2 py-1 text-[11px] text-muted-foreground"
    >
      <span>{{ t("merge.inlineHint") }}</span>
      <template v-if="active?.manual && !active.confirmed">
        <span class="ml-auto">{{ t("merge.manualHint") }}</span>
        <Button size="xs" variant="outline" :disabled="tab.saving" @click="keepManual">{{
          t("merge.keepManual")
        }}</Button>
      </template>
    </div>
    <div class="grid min-h-0 flex-1 grid-cols-3 gap-px bg-border">
      <div class="flex min-h-0 min-w-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {{ t("merge.changesFrom", { branch: tab.yoursLabel }) }}
        </div>
        <MergeTextPane
          :key="tab.id + ':ours'"
          ref="left"
          :owner-id="tab.id"
          :state="leftState"
          :label="tab.yoursLabel"
          :extensions="leftDecorations"
        />
      </div>
      <div class="flex min-h-0 min-w-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium">
          {{ t("merge.editableResult") }}
        </div>
        <MergeTextPane
          :key="tab.id + ':result'"
          ref="result"
          :owner-id="tab.id"
          :state="tab.mergeState"
          :label="t('merge.editableResult')"
          editable
          :disabled="tab.saving"
          :extensions="resultHighlights"
          @change="updateState"
        />
      </div>
      <div class="flex min-h-0 min-w-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {{ t("merge.changesFrom", { branch: tab.theirsLabel }) }}
        </div>
        <MergeTextPane
          :key="tab.id + ':theirs'"
          ref="right"
          :owner-id="tab.id"
          :state="rightState"
          :label="tab.theirsLabel"
          :extensions="rightDecorations"
        />
      </div>
    </div>
  </div>
  <div v-else class="flex h-full items-center justify-center text-sm text-muted-foreground">
    {{ t("merge.noEditor") }}
  </div>
</template>
