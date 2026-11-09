<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { unresolvedConflictCount } from "./mergeResult";
import { Button } from "@/components/ui/button";
import { useConflictsStore } from "@/stores/conflictsStore";

const conflicts = useConflictsStore();
const { t } = useI18n();

const tab = computed(() =>
  conflicts.activeMergeId
    ? (conflicts.mergeTabs.find((t) => t.id === conflicts.activeMergeId) ?? null)
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

const remaining = computed(() => unresolvedConflictCount(tab.value?.resultText ?? ""));
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col">
    <div class="flex min-h-8 flex-wrap items-center gap-2 py-1 border-b bg-dbx-chrome px-2 text-xs">
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
        <pre class="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-5">{{
          tab.merge3?.blocks.flatMap((b) => b.oursLines).join("")
        }}</pre>
      </div>
      <div class="flex min-h-0 min-w-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium">
          {{ t("merge.editableResult") }}
        </div>
        <textarea
          v-model="tab.resultText"
          :aria-label="t('merge.editableResult')"
          :disabled="tab.saving"
          @input="tab.error = null"
          class="min-h-0 flex-1 resize-none bg-transparent p-2 font-mono text-[11px] leading-5 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          spellcheck="false"
        />
      </div>
      <div class="flex min-h-0 min-w-0 flex-col bg-background">
        <div class="border-b px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {{ t("merge.changesFrom", { branch: tab.theirsLabel }) }}
        </div>
        <pre class="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-5">{{
          tab.merge3?.blocks.flatMap((b) => b.theirsLines).join("")
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
        <span class="w-20 font-medium">{{ t(`merge.blocks.${b.kind}`) }}</span>
        <span class="flex-1 truncate font-mono text-muted-foreground">
          {{ (b.oursLines[0] || b.theirsLines[0] || b.baseLines[0] || "").slice(0, 80) }}
        </span>
        <template v-if="b.kind === 'conflict'">
          <Button
            size="xs"
            variant="ghost"
            :disabled="tab.saving"
            :aria-label="t('merge.acceptBlockLeft', { index: i + 1 })"
            @click="conflicts.acceptBlock(tab.id, i, 'ours')"
            >≪</Button
          >
          <Button
            size="xs"
            variant="ghost"
            :disabled="tab.saving"
            :aria-label="t('merge.acceptBlockRight', { index: i + 1 })"
            @click="conflicts.acceptBlock(tab.id, i, 'theirs')"
            >≫</Button
          >
        </template>
      </div>
    </div>
  </div>
  <div v-else class="flex h-full items-center justify-center text-sm text-muted-foreground">
    {{ t("merge.noEditor") }}
  </div>
</template>
