<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import { unresolvedConflictCount } from "./mergeResult";
import { Button } from "@/components/ui/button";
import { useConflictsStore } from "@/stores/conflictsStore";
import TextViewport from "@/components/common/TextViewport.vue";
import VirtualList from "@/components/common/VirtualList.vue";

const conflicts = useConflictsStore();
const { t } = useI18n();

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
const remaining = computed(() => unresolvedConflictCount(tab.value?.resultText ?? ""));

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
  if (!tab.value?.merge3 || tab.value.saving) return;
  tab.value.merge3.blocks.forEach((_, i) => {
    if (tab.value!.merge3!.blocks[i].kind === "conflict") {
      conflicts.acceptBlock(tab.value!.id, i, side);
    }
  });
}

function applyNonConflicting() {
  if (!tab.value?.merge3 || tab.value.saving) return;
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
  tab.value.error = null;
}
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col">
    <div class="flex min-h-8 flex-wrap items-center gap-2 border-b bg-dbx-chrome px-2 py-1 text-xs">
      <span class="truncate font-medium">{{ tab.title }}</span>
      <span class="text-muted-foreground">
        {{ t("merge.remaining", { count: remaining }) }}
      </span>
      <div class="ml-auto flex flex-wrap gap-1">
        <span class="self-center text-[11px] text-muted-foreground">{{
          t("merge.autoMerged")
        }}</span>
        <Button
          size="xs"
          variant="outline"
          :disabled="tab.saving || !remaining"
          @click="applyNonConflicting"
          >{{ t("merge.applyNonConflicting") }}</Button
        >
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
          >{{ tab.saving ? t("merge.saving") : t("merge.saveResolved") }}</Button
        >
      </div>
    </div>
    <p v-if="tab.error" role="alert" class="border-b px-2 py-1 text-xs text-destructive">
      {{ tab.error }}
    </p>
    <div class="grid min-h-0 flex-1 grid-cols-3 gap-px bg-border">
      <div class="flex min-h-0 min-w-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {{ t("merge.changesFrom", { branch: tab.yoursLabel }) }}
        </div>
        <TextViewport
          :key="`${tab.id}:ours`"
          :text="oursText"
          :label="tab.yoursLabel"
          class="flex-1"
        />
      </div>
      <div class="flex min-h-0 min-w-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium">
          {{ t("merge.editableResult") }}
        </div>
        <TextViewport
          :key="`${tab.id}:result`"
          v-model:text="tab.resultText"
          editable
          :label="t('merge.editableResult')"
          class="flex-1"
          @update:text="tab.error = null"
        />
      </div>
      <div class="flex min-h-0 min-w-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {{ t("merge.changesFrom", { branch: tab.theirsLabel }) }}
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
      :key="tab.id"
      :items="tab.merge3.blocks"
      :item-height="32"
      :get-key="(_, index) => index"
      class="shrink-0 !flex-none border-t text-[11px]"
      :style="{ height: `${Math.min(128, tab.merge3.blocks.length * 32)}px` }"
      @keydown="blockKey"
    >
      <template #default="{ item: b, index: i }">
        <div
          class="flex h-full items-center gap-2 border-b px-2 py-1"
          :class="b.kind === 'conflict' ? 'bg-[var(--diff-conflict-bg)]' : ''"
        >
          <span class="w-20 font-medium">{{ t(`merge.blocks.${b.kind}`) }}</span>
          <span class="flex-1 truncate font-mono text-muted-foreground">
            {{ (b.oursLines[0] || b.theirsLines[0] || b.baseLines[0] || "").slice(0, 80) }}
          </span>
          <template v-if="b.kind === 'conflict'">
            <Button
              size="xs"
              variant="ghost"
              :data-merge-block="i"
              data-merge-side="ours"
              :disabled="tab.saving"
              :aria-label="t('merge.acceptBlockLeft', { index: i + 1 })"
              @click="conflicts.acceptBlock(tab.id, i, 'ours')"
              >≪</Button
            >
            <Button
              size="xs"
              variant="ghost"
              :data-merge-block="i"
              data-merge-side="theirs"
              :disabled="tab.saving"
              :aria-label="t('merge.acceptBlockRight', { index: i + 1 })"
              @click="conflicts.acceptBlock(tab.id, i, 'theirs')"
              >≫</Button
            >
          </template>
        </div>
      </template>
    </VirtualList>
  </div>
  <div v-else class="flex h-full items-center justify-center text-sm text-muted-foreground">
    {{ t("merge.noEditor") }}
  </div>
</template>
