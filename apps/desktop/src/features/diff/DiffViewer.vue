<script setup lang="ts">
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { useDiffStore } from "@/stores/diffStore";
import { useChangesStore } from "@/stores/changesStore";
import { toast } from "@/composables/useToast";

const props = defineProps<{ tabId: string }>();
const diffs = useDiffStore();
const changes = useChangesStore();

const tab = computed(() => diffs.tabs.find((t) => t.id === props.tabId));
const result = computed(() => tab.value?.result);

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

const canStage = computed(() => tab.value?.right === "worktree");
const canUnstage = computed(() => tab.value?.left === "head" && tab.value?.right === "index");
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col">
    <div class="flex h-8 items-center gap-2 border-b bg-dbx-chrome px-2 text-xs">
      <span class="font-medium">{{ tab.path }}</span>
      <span class="text-muted-foreground">
        {{ result?.leftLabel }} → {{ result?.rightLabel }}
      </span>
      <div class="flex-1" />
      <Button
        size="xs"
        variant="ghost"
        @click="diffs.setUnified(tab.id, !tab.unified)"
      >
        {{ tab.unified ? "Side-by-side" : "Unified" }}
      </Button>
    </div>

    <div v-if="tab.loading" class="p-4 text-xs text-muted-foreground">Loading diff…</div>
    <div v-else-if="result?.binary" class="p-4 text-xs">Binary file — stage as a whole file.</div>
    <div v-else-if="result?.tooLarge" class="p-4 text-xs">File is too large to show.</div>
    <div v-else-if="!result?.hunks.length" class="p-4 text-xs text-muted-foreground">
      No differences
    </div>
    <div v-else class="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5">
      <div v-for="hunk in result.hunks" :key="hunk.index" class="border-b">
        <div
          class="sticky top-0 flex items-center gap-2 bg-muted/80 px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          <span>{{ hunk.header }}</span>
          <div class="flex-1" />
          <Button v-if="canStage" size="xs" variant="outline" @click="stageHunk(hunk.index)">
            Stage Hunk
          </Button>
          <Button
            v-if="canUnstage"
            size="xs"
            variant="outline"
            @click="unstageHunk(hunk.index)"
          >
            Unstage Hunk
          </Button>
        </div>
        <div
          v-if="tab.unified"
          class="whitespace-pre"
        >
          <div
            v-for="(line, i) in hunk.lines"
            :key="i"
            class="px-2"
            :class="{
              'bg-[rgb(var(--diff-insert-bg))]': line.startsWith('+'),
              'bg-[rgb(var(--diff-delete-bg))]': line.startsWith('-'),
            }"
          >
            {{ line }}
          </div>
        </div>
        <div v-else class="grid grid-cols-2">
          <div class="border-r whitespace-pre">
            <div
              v-for="(line, i) in hunk.lines.filter((l) => !l.startsWith('+'))"
              :key="`l-${i}`"
              class="px-2"
              :class="{ 'bg-[rgb(var(--diff-delete-bg))]': line.startsWith('-') }"
            >
              {{ line.startsWith('-') || line.startsWith(' ') ? line.slice(1) : line }}
            </div>
          </div>
          <div class="whitespace-pre">
            <div
              v-for="(line, i) in hunk.lines.filter((l) => !l.startsWith('-'))"
              :key="`r-${i}`"
              class="px-2"
              :class="{ 'bg-[rgb(var(--diff-insert-bg))]': line.startsWith('+') }"
            >
              {{ line.startsWith('+') || line.startsWith(' ') ? line.slice(1) : line }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
