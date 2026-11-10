<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { closeDialog, useDialogStack, useDialogState } from "@/composables/useDialog";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { useConflictsStore } from "@/stores/conflictsStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { formatErrorMessage } from "@/lib/errors";
import type { ConflictEntry } from "@/lib/backend";

const { t } = useI18n();
const conflicts = useConflictsStore();
const rewrite = useRewriteStore();
const dialog = useDialogState();
const stack = useDialogStack();
const dialogId = dialog.value?.id;
const capture = useRepositoryAction(() => closeDialog(false, dialogId));
const source = capture();
const phase = ref<"load" | "open" | "write" | "continue" | null>(null);
const ready = ref(false);
const error = ref<string | null>(null);
let visibilityRevision = 0;
let anchor: string | null = null;
const busy = computed(() => !!phase.value || conflicts.busy || conflicts.loading || rewrite.busy);
const canDismiss = computed(
  () => !conflicts.busy && !rewrite.busy && phase.value !== "write" && phase.value !== "continue",
);
const loaded = computed(() => ready.value && !conflicts.refreshError);
const visibleError = computed(() => error.value || conflicts.refreshError);
const selectedEntry = computed(() =>
  conflicts.entries.find((e) => conflicts.selected.includes(e.path)),
);
const alive = () => source.current() && stack.value.some((item) => item.id === dialogId);
const current = () => alive() && dialog.value?.id === dialogId;

function dismiss() {
  if (current() && canDismiss.value) closeDialog(false, dialogId);
}
// A covered dialog may reappear, but its old editor request must stay cancelled.
watch(
  () => dialog.value?.id,
  () => ++visibilityRevision,
  { flush: "sync" },
);

async function load() {
  if (!current() || phase.value) return;
  phase.value = "load";
  ready.value = false;
  error.value = null;
  try {
    const results = await Promise.allSettled([conflicts.refresh(), rewrite.refreshOpState()]);
    if (!alive()) return;
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    if (
      results.some(
        (result) =>
          result.status === "fulfilled" && (result.value === false || result.value === null),
      )
    )
      throw new Error(t("merge.loadInterrupted"));
    ready.value = true;
    if (!conflicts.selected.length && conflicts.entries[0])
      conflicts.selected = [conflicts.entries[0].path];
  } catch (e) {
    if (alive()) error.value = formatErrorMessage(e);
  } finally {
    phase.value = null;
  }
}
onMounted(load);

function selectEntry(entry: ConflictEntry, event: MouseEvent) {
  if (!current() || busy.value || !loaded.value || event.altKey) return;
  const start = conflicts.entries.findIndex((e) => e.path === anchor);
  const end = conflicts.entries.findIndex((e) => e.path === entry.path);
  if (event.shiftKey && start >= 0 && end >= 0) {
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

function toggleEntry(entry: ConflictEntry) {
  if (current() && loaded.value && !busy.value) conflicts.toggleSelect(entry.path);
}

function rowKey(entry: ConflictEntry, event: KeyboardEvent) {
  if (
    event.target !== event.currentTarget ||
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  )
    return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Enter") void mergeEntry(entry);
  else toggleEntry(entry);
}

async function run(
  kind: "open" | "write" | "continue",
  action: (valid: () => boolean) => Promise<unknown>,
) {
  if (!current() || busy.value || !loaded.value) return;
  const revision = visibilityRevision;
  const valid = () => current() && revision === visibilityRevision;
  phase.value = kind;
  error.value = null;
  try {
    await action(valid);
  } catch (e) {
    if (valid()) error.value = formatErrorMessage(e);
  } finally {
    phase.value = null;
  }
}

async function mergeEntry(entry?: ConflictEntry) {
  if (!entry || entry.kind === "binary" || entry.kind === "submodule") return;
  await run("open", async (valid) => {
    const opened = await conflicts.openMerge(entry, valid);
    if (opened && valid()) closeDialog(true, dialogId);
  });
}

async function continueAfter() {
  if (conflicts.entries.length || !rewrite.opState || rewrite.opState.kind === "normal") return;
  await run("continue", async (valid) => {
    const result = await rewrite.continueOp();
    if (valid() && result && result.outcome !== "conflicts") closeDialog(true, dialogId);
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
      <p v-if="visibleError" role="alert" class="mt-2 text-xs text-destructive">
        {{ visibleError }}
      </p>
      <Button
        v-if="!loaded && visibleError"
        size="sm"
        variant="outline"
        class="mt-2 self-start"
        :disabled="busy"
        @click="load"
        >{{ t("merge.retryLoad") }}</Button
      >
      <p v-if="phase === 'load' || phase === 'open'" role="status" class="mt-3 text-xs">
        {{ t("common.loading") }}
      </p>
      <div v-if="loaded" class="mt-3 min-h-0 flex-1 overflow-auto rounded border">
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
              @keydown="rowKey(entry, $event)"
            >
              <td class="px-2 py-1">
                <input
                  type="checkbox"
                  :aria-label="t('merge.selectFile', { path: entry.path })"
                  :disabled="busy"
                  :checked="conflicts.selected.includes(entry.path)"
                  @click.stop
                  @dblclick.stop
                  @change="toggleEntry(entry)"
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
            :disabled="busy || !loaded || !conflicts.selected.length"
            @click="run('write', () => conflicts.acceptSide('ours', [...conflicts.selected]))"
            >{{ t("merge.acceptYours") }}</Button
          >
          <Button
            size="sm"
            variant="outline"
            :disabled="busy || !loaded || !conflicts.selected.length"
            @click="run('write', () => conflicts.acceptSide('theirs', [...conflicts.selected]))"
            >{{ t("merge.acceptTheirs") }}</Button
          >
          <Button
            size="sm"
            variant="outline"
            :disabled="
              busy ||
              !loaded ||
              !selectedEntry ||
              ['binary', 'submodule'].includes(selectedEntry.kind)
            "
            @click="mergeEntry(selectedEntry)"
            >{{ t("merge.openEditor") }}</Button
          >
          <Button
            size="sm"
            variant="secondary"
            :disabled="busy || !loaded || !conflicts.entries.length"
            @click="run('write', () => conflicts.resolveSimple())"
            >{{ t("merge.resolveSimple") }}</Button
          >
        </div>
        <div class="flex gap-2">
          <Button
            v-if="
              loaded &&
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
          <Button variant="ghost" size="sm" :disabled="!canDismiss" @click="dismiss">{{
            t("common.close")
          }}</Button>
        </div>
      </div>
    </div>
  </div>
</template>
