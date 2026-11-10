<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { Button } from "@/components/ui/button";
import { useConflictsStore } from "@/stores/conflictsStore";
import TextViewport from "@/components/common/TextViewport.vue";
import VirtualList from "@/components/common/VirtualList.vue";

const conflicts = useConflictsStore();

const tab = computed(() =>
  conflicts.activeMergeId
    ? (conflicts.mergeTabs.find((t) => t.id === conflicts.activeMergeId) ?? null)
    : null,
);
const oursText = computed(
  () => tab.value?.merge3?.blocks.flatMap((b) => b.oursLines).join("\n") ?? "",
);
const theirsText = computed(
  () => tab.value?.merge3?.blocks.flatMap((b) => b.theirsLines).join("\n") ?? "",
);

const blocksView = ref<{ scrollToIndex: (index: number) => void; $el: HTMLElement } | null>(null);
const conflictIndices = computed(
  () =>
    tab.value?.merge3?.blocks.flatMap((block, index) =>
      block.kind === "conflict" ? [index] : [],
    ) ?? [],
);
async function blockKey(event: KeyboardEvent) {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "button[data-merge-block]",
  );
  if (!button) return;
  const indices = conflictIndices.value;
  const row = indices.indexOf(Number(button.dataset.mergeBlock));
  if (row < 0) return;
  const side = button.dataset.mergeSide === "ours" ? 0 : 1;
  let target = row * 2 + side;
  if (event.key === "ArrowDown") target += 2;
  else if (event.key === "ArrowUp") target -= 2;
  else if (event.key === "Home") target = side;
  else if (event.key === "End") target = (indices.length - 1) * 2 + side;
  else if (event.key === "Tab") target += event.shiftKey ? -1 : 1;
  else return;
  if (target < 0 || target >= indices.length * 2) return;
  event.preventDefault();
  event.stopPropagation();
  const index = indices[Math.floor(target / 2)]!;
  const direction = target % 2 ? "theirs" : "ours";
  const activeTab = tab.value?.id;
  blocksView.value?.scrollToIndex(index);
  await nextTick();
  if (tab.value?.id !== activeTab) return;
  blocksView.value?.$el
    .querySelector<HTMLButtonElement>(
      `[data-merge-block="${index}"][data-merge-side="${direction}"]`,
    )
    ?.focus({ preventScroll: true });
}

function acceptAll(side: "ours" | "theirs") {
  if (!tab.value?.merge3) return;
  tab.value.merge3.blocks.forEach((_, i) => {
    if (tab.value!.merge3!.blocks[i].kind === "conflict") {
      conflicts.acceptBlock(tab.value!.id, i, side);
    }
  });
}

function applyNonConflicting() {
  if (!tab.value?.merge3) return;
  // result already prefers non-conflict resultLines; rebuild text
  const blocks = tab.value.merge3.blocks;
  tab.value.resultText =
    blocks
      .map((b) =>
        b.kind === "conflict"
          ? ["<<<<<<< Yours", ...b.oursLines, "=======", ...b.theirsLines, ">>>>>>> Theirs"].join(
              "\n",
            )
          : b.resultLines.join("\n"),
      )
      .filter(Boolean)
      .join("\n") + "\n";
}
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col">
    <div class="flex h-8 items-center gap-1 border-b bg-dbx-chrome px-2 text-xs">
      <span class="truncate font-medium">{{ tab.title }}</span>
      <span class="text-muted-foreground"> {{ tab.merge3?.conflictCount ?? 0 }} conflict(s) </span>
      <div class="ml-auto flex gap-1">
        <Button size="xs" variant="outline" @click="applyNonConflicting"
          >Apply Non-Conflicting</Button
        >
        <Button size="xs" variant="outline" @click="acceptAll('ours')">Accept Left</Button>
        <Button size="xs" variant="outline" @click="acceptAll('theirs')">Accept Right</Button>
        <Button size="xs" @click="conflicts.applyMergeResult(tab.id)">Apply</Button>
      </div>
    </div>
    <div class="grid min-h-0 flex-1 grid-cols-3 gap-px bg-border">
      <div class="flex min-h-0 min-w-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium text-muted-foreground">
          Changes from {{ tab.yoursLabel }}
        </div>
        <TextViewport
          :key="`${tab.id}:ours`"
          :text="oursText"
          :label="tab.yoursLabel"
          class="flex-1"
        />
      </div>
      <div class="flex min-h-0 min-w-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium">Result (editable)</div>
        <TextViewport
          :key="`${tab.id}:result`"
          v-model:text="tab.resultText"
          editable
          label="Result (editable)"
          class="flex-1"
        />
      </div>
      <div class="flex min-h-0 min-w-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium text-muted-foreground">
          Changes from {{ tab.theirsLabel }}
        </div>
        <TextViewport
          :key="`${tab.id}:theirs`"
          :text="theirsText"
          :label="tab.theirsLabel"
          class="flex-1"
        />
      </div>
    </div>
    <VirtualList
      v-if="tab.merge3"
      ref="blocksView"
      @keydown="blockKey"
      :key="tab.id"
      :items="tab.merge3.blocks"
      :item-height="32"
      :get-key="(_, index) => index"
      class="shrink-0 !flex-none border-t text-[11px]"
      :style="{ height: `${Math.min(128, tab.merge3.blocks.length * 32)}px` }"
    >
      <template #default="{ item: b, index: i }">
        <div
          class="flex h-full items-center gap-2 border-b px-2 py-1"
          :class="b.kind === 'conflict' ? 'bg-[var(--diff-conflict-bg)]' : ''"
        >
          <span class="w-20 font-medium">{{ b.kind }}</span>
          <span class="flex-1 truncate font-mono text-muted-foreground">
            {{ (b.oursLines[0] || b.theirsLines[0] || b.baseLines[0] || "").slice(0, 80) }}
          </span>
          <template v-if="b.kind === 'conflict'">
            <Button
              size="xs"
              variant="ghost"
              :data-merge-block="i"
              data-merge-side="ours"
              @click="conflicts.acceptBlock(tab.id, i, 'ours')"
              >≪</Button
            >
            <Button
              size="xs"
              variant="ghost"
              :data-merge-block="i"
              data-merge-side="theirs"
              @click="conflicts.acceptBlock(tab.id, i, 'theirs')"
              >≫</Button
            >
          </template>
        </div>
      </template>
    </VirtualList>
  </div>
  <div v-else class="flex h-full items-center justify-center text-sm text-muted-foreground">
    No merge editor open
  </div>
</template>
