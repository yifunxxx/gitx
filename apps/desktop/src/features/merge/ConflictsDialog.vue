<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { useConflictsStore } from "@/stores/conflictsStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { formatErrorMessage } from "@/lib/errors";
import type { ConflictEntry } from "@/lib/backend";

const { t } = useI18n();
const conflicts = useConflictsStore();
const rewrite = useRewriteStore();
const workspace = useWorkspaceStore();
const dialog = useDialogState();
const dialogId = dialog.value?.id;
const path = workspace.repoPath;
const working = ref(false);
const ready = ref(false);
const error = ref<string | null>(null);
let disposed = false;
let invalidated = false;
let anchor: string | null = null;
const busy = computed(() => working.value || conflicts.busy || rewrite.busy);
const selectedEntry = computed(() =>
  conflicts.entries.find((e) => conflicts.selected.includes(e.path)),
);
const current = () =>
  !disposed && !invalidated && workspace.repoPath === path && dialog.value?.id === dialogId;

function dismiss() {
  if (current() && !busy.value) closeDialog(false, dialogId);
}
watch(
  () => workspace.repoPath,
  () => {
    if (!disposed) closeDialog(false, dialogId);
    invalidated = true;
  },
  { flush: "sync" },
);
onUnmounted(() => {
  disposed = true;
});

onMounted(async () => {
  working.value = true;
  try {
    await Promise.all([conflicts.refresh(), rewrite.refreshOpState()]);
    if (!current()) return;
    ready.value = true;
    if (!conflicts.selected.length && conflicts.entries[0])
      conflicts.selected = [conflicts.entries[0].path];
  } catch (e) {
    if (current()) error.value = formatErrorMessage(e);
  } finally {
    working.value = false;
  }
});

function selectEntry(entry: ConflictEntry, event: MouseEvent) {
  if (busy.value) return;
  if (event.shiftKey && anchor) {
    const start = conflicts.entries.findIndex((e) => e.path === anchor);
    const end = conflicts.entries.findIndex((e) => e.path === entry.path);
    conflicts.selected = conflicts.entries
      .slice(Math.min(start, end), Math.max(start, end) + 1)
      .map((e) => e.path);
  } else if (event.ctrlKey || event.metaKey) {
    conflicts.toggleSelect(entry.path);
    anchor = entry.path;
  } else {
    conflicts.selected = [entry.path];
    anchor = entry.path;
  }
}

async function run(action: () => Promise<unknown>) {
  if (!current() || busy.value || !ready.value) return;
  working.value = true;
  error.value = null;
  try {
    await action();
  } catch (e) {
    if (current()) error.value = formatErrorMessage(e);
  } finally {
    working.value = false;
  }
}

async function mergeEntry(entry?: ConflictEntry) {
  if (!entry || entry.kind === "binary" || entry.kind === "submodule") return;
  await run(async () => {
    await conflicts.openMerge(entry);
    if (current()) closeDialog(true, dialogId);
  });
}

async function continueAfter() {
  await run(async () => {
    const result = await rewrite.continueOp();
    if (current() && result?.outcome !== "conflicts") closeDialog(true, dialogId);
  });
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4"
    @keydown.esc.stop.prevent="dismiss"
  >
    <div
      role="dialog"
      aria-modal="true"
      :aria-label="t('merge.conflicts')"
      class="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border bg-popover p-4 shadow-lg"
    >
      <h2 class="text-sm font-semibold">{{ t("merge.conflicts") }}</h2>
      <p class="mt-1 text-[11px] text-muted-foreground">
        {{
          t("merge.sideLabels", {
            ours: conflicts.list?.yoursLabel ?? "",
            theirs: conflicts.list?.theirsLabel ?? "",
          })
        }}
      </p>
      <p v-if="error" role="alert" class="mt-2 text-xs text-destructive">{{ error }}</p>
      <p v-if="!ready && working" role="status" class="mt-3 text-xs">{{ t("common.loading") }}</p>
      <div v-if="ready" class="mt-3 min-h-0 flex-1 overflow-auto rounded border">
        <table class="w-full text-left text-xs">
          <thead class="sticky top-0 bg-muted">
            <tr>
              <th class="w-8 px-2 py-1" />
              <th class="px-2 py-1">{{ t("merge.file") }}</th>
              <th class="px-2 py-1">{{ t("merge.yours") }}</th>
              <th class="px-2 py-1">{{ t("merge.theirs") }}</th>
              <th class="px-2 py-1">{{ t("merge.type") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in conflicts.entries"
              :key="entry.path"
              class="cursor-default border-t hover:bg-accent/50 focus-visible:outline focus-visible:outline-ring"
              :class="conflicts.selected.includes(entry.path) ? 'bg-accent' : ''"
              :aria-selected="conflicts.selected.includes(entry.path)"
              tabindex="0"
              @click="selectEntry(entry, $event)"
              @dblclick="mergeEntry(entry)"
              @keydown.enter.prevent="mergeEntry(entry)"
              @keydown.space.prevent="conflicts.toggleSelect(entry.path)"
            >
              <td class="px-2 py-1">
                <input
                  type="checkbox"
                  :aria-label="t('merge.selectFile', { path: entry.path })"
                  :disabled="busy"
                  :checked="conflicts.selected.includes(entry.path)"
                  @click.stop
                  @dblclick.stop
                  @change="conflicts.toggleSelect(entry.path)"
                />
              </td>
              <td class="px-2 py-1 font-mono">{{ entry.path }}</td>
              <td class="px-2 py-1">{{ t(`merge.status.${entry.yours}`) }}</td>
              <td class="px-2 py-1">{{ t(`merge.status.${entry.theirs}`) }}</td>
              <td class="px-2 py-1">{{ t(`merge.kinds.${entry.kind}`) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="!conflicts.entries.length" class="p-4 text-center text-xs text-muted-foreground">
          {{ t("merge.allResolved") }}
        </div>
      </div>
      <div class="mt-4 flex flex-wrap justify-between gap-2">
        <div class="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            :disabled="busy || !ready || !conflicts.selected.length"
            @click="run(() => conflicts.acceptSide('ours', conflicts.selected))"
            >{{ t("merge.acceptYours") }}</Button
          >
          <Button
            size="sm"
            variant="outline"
            :disabled="busy || !ready || !conflicts.selected.length"
            @click="run(() => conflicts.acceptSide('theirs', conflicts.selected))"
            >{{ t("merge.acceptTheirs") }}</Button
          >
          <Button
            size="sm"
            variant="outline"
            :disabled="
              busy ||
              !ready ||
              !selectedEntry ||
              ['binary', 'submodule'].includes(selectedEntry.kind)
            "
            @click="mergeEntry(selectedEntry)"
            >{{ t("merge.openEditor") }}</Button
          >
          <Button
            size="sm"
            variant="secondary"
            :disabled="busy || !ready || !conflicts.entries.length"
            @click="run(() => conflicts.resolveSimple())"
            >{{ t("merge.resolveSimple") }}</Button
          >
        </div>
        <div class="flex gap-2">
          <Button
            v-if="
              ready &&
              !conflicts.entries.length &&
              rewrite.opState &&
              rewrite.opState.kind !== 'normal'
            "
            size="sm"
            :disabled="busy"
            @click="continueAfter"
            >{{
              rewrite.opState.kind === "merge" ? t("merge.commitMerge") : t("merge.continue")
            }}</Button
          >
          <Button variant="ghost" size="sm" :disabled="busy" @click="dismiss">{{
            t("common.close")
          }}</Button>
        </div>
      </div>
    </div>
  </div>
</template>
