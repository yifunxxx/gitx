<script setup lang="ts">
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { useDiffStore } from "@/stores/diffStore";
import { useChangesStore } from "@/stores/changesStore";
import { toast } from "@/composables/useToast";
import type { IgnoreWhitespace } from "@/lib/backend";
import CodeMirrorDiff from "./CodeMirrorDiff.vue";

const props = defineProps<{ tabId: string }>();
const diffs = useDiffStore();
const changes = useChangesStore();

const tab = computed(() => diffs.tabs.find((t) => t.id === props.tabId));
const result = computed(() => tab.value?.result);

const visibleHunks = computed(() => {
  if (!result.value) return [];
  if (tab.value?.collapseUnchanged) return result.value.hunks;
  return result.value.hunks;
});

async function stageHunk(index: number) {
  if (!tab.value) return;
  await diffs.stageHunks(tab.value.path, [index]);
  toast({ title: "Hunk staged" });
  await changes.refresh();
  await diffs.openFileDiff(tab.value.path, tab.value.left, tab.value.right);
}

async function unstageHunk(index: number) {
  if (!tab.value) return;
  await diffs.unstageHunks(tab.value.path, [index]);
  toast({ title: "Hunk unstaged" });
  await changes.refresh();
  await diffs.openFileDiff(tab.value.path, tab.value.left, tab.value.right);
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

const leftText = computed(() => result.value?.leftText ?? "");
const rightText = computed(() => result.value?.rightText ?? "");
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col">
    <div class="flex h-8 flex-wrap items-center gap-2 border-b bg-dbx-chrome px-2 text-xs">
      <span class="font-medium">{{ tab.path }}</span>
      <span class="text-muted-foreground">
        {{ result?.leftLabel }} → {{ result?.rightLabel }}
      </span>
      <div class="flex-1" />
      <label class="flex items-center gap-1 text-[11px] text-muted-foreground">
        Whitespace
        <select
          class="h-6 rounded border bg-background px-1 text-[11px]"
          :value="tab.ignoreWhitespace"
          @change="
            diffs.setIgnoreWhitespace(
              tab.id,
              ($event.target as HTMLSelectElement).value as IgnoreWhitespace,
            )
          "
        >
          <option v-for="m in wsModes" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
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
    </div>

    <div v-if="tab.loading" class="p-4 text-xs text-muted-foreground">Loading diff…</div>
    <div v-else-if="result?.binary" class="p-4 text-xs">Binary file — stage as a whole file.</div>
    <div v-else-if="result?.tooLarge" class="p-4 text-xs">
      File is too large to show —
      <button type="button" class="underline" @click="diffs.reloadTab(tab)">Show anyway</button>
    </div>
    <div v-else-if="!result?.hunks.length" class="p-4 text-xs text-muted-foreground">
      No differences
    </div>
    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div v-if="tab.unified" class="min-h-0 flex-1">
        <CodeMirrorDiff side="unified" unified :text="''" :hunks="visibleHunks" />
      </div>
      <div v-else class="grid min-h-0 flex-1 grid-cols-2">
        <div class="min-h-0 border-r">
          <CodeMirrorDiff side="left" :text="leftText" :hunks="visibleHunks" />
        </div>
        <div class="min-h-0">
          <CodeMirrorDiff side="right" :text="rightText" :hunks="visibleHunks" />
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
