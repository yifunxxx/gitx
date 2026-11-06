<script setup lang="ts">
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { useConflictsStore } from "@/stores/conflictsStore";

const conflicts = useConflictsStore();

const tab = computed(() =>
  conflicts.activeMergeId
    ? conflicts.mergeTabs.find((t) => t.id === conflicts.activeMergeId) ?? null
    : null,
);

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
      <span class="text-muted-foreground">
        {{ tab.merge3?.conflictCount ?? 0 }} conflict(s)
      </span>
      <div class="ml-auto flex gap-1">
        <Button size="xs" variant="outline" @click="applyNonConflicting">Apply Non-Conflicting</Button>
        <Button size="xs" variant="outline" @click="acceptAll('ours')">Accept Left</Button>
        <Button size="xs" variant="outline" @click="acceptAll('theirs')">Accept Right</Button>
        <Button size="xs" @click="conflicts.applyMergeResult(tab.id)">Apply</Button>
      </div>
    </div>
    <div class="grid min-h-0 flex-1 grid-cols-3 gap-px bg-border">
      <div class="flex min-h-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium text-muted-foreground">
          Changes from {{ tab.yoursLabel }}
        </div>
        <pre class="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-5">{{
          tab.merge3?.blocks.flatMap((b) => b.oursLines).join("\n")
        }}</pre>
      </div>
      <div class="flex min-h-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium">Result (editable)</div>
        <textarea
          v-model="tab.resultText"
          class="min-h-0 flex-1 resize-none bg-transparent p-2 font-mono text-[11px] leading-5 outline-none"
          spellcheck="false"
        />
      </div>
      <div class="flex min-h-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium text-muted-foreground">
          Changes from {{ tab.theirsLabel }}
        </div>
        <pre class="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-5">{{
          tab.merge3?.blocks.flatMap((b) => b.theirsLines).join("\n")
        }}</pre>
      </div>
    </div>
    <div v-if="tab.merge3" class="max-h-32 overflow-auto border-t text-[11px]">
      <div
        v-for="(b, i) in tab.merge3.blocks"
        :key="i"
        class="flex items-center gap-2 border-b px-2 py-1"
        :class="b.kind === 'conflict' ? 'bg-[var(--diff-conflict-bg)]' : ''"
      >
        <span class="w-20 font-medium">{{ b.kind }}</span>
        <span class="flex-1 truncate font-mono text-muted-foreground">
          {{ (b.oursLines[0] || b.theirsLines[0] || b.baseLines[0] || "").slice(0, 80) }}
        </span>
        <template v-if="b.kind === 'conflict'">
          <Button size="xs" variant="ghost" @click="conflicts.acceptBlock(tab.id, i, 'ours')">≪</Button>
          <Button size="xs" variant="ghost" @click="conflicts.acceptBlock(tab.id, i, 'theirs')">≫</Button>
        </template>
      </div>
    </div>
  </div>
  <div v-else class="flex h-full items-center justify-center text-sm text-muted-foreground">
    No merge editor open
  </div>
</template>
