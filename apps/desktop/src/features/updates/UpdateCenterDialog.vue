<script setup lang="ts">
import { computed, onBeforeUnmount, useId } from "vue";
import { useI18n } from "vue-i18n";
import { X } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { closeDialog, useDialogStack, useDialogState } from "@/composables/useDialog";
import { useUpdateStore } from "@/stores/updateStore";

const { t } = useI18n();
const updates = useUpdateStore();
const dialog = useDialogState();
const stack = useDialogStack();
const dialogId = dialog.value?.id;
const titleId = useId();
let disposed = false;

const present = () => !disposed && stack.value.some((entry) => entry.id === dialogId);
const current = () => present() && dialog.value?.id === dialogId;

onBeforeUnmount(() => {
  disposed = true;
});

const badgeText = computed(() =>
  updates.updateAvailable ? t("updates.badgeAvailable", { count: 1 }) : t("updates.badgeNone"),
);

const summaryText = computed(() => {
  const info = updates.latest;
  if (!info) return t("updates.checkHint");
  if (!info.newer) {
    return t("updates.upToDateBody", { version: info.currentVersion });
  }
  return t("updates.summary", {
    latest: info.latestVersion,
    current: info.currentVersion,
  });
});

const notes = computed(() => {
  const body = updates.latest?.notes?.trim();
  return body || t("updates.noNotes");
});

const busy = computed(
  () =>
    updates.checking ||
    updates.phase === "downloading" ||
    updates.phase === "installing",
);

function close() {
  if (!current()) return;
  closeDialog(false, dialogId);
}

function onEscape(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || busy.value) return;
  event.preventDefault();
  event.stopPropagation();
  close();
}

async function ignoreVersion() {
  if (!current() || busy.value) return;
  updates.ignoreThisVersion();
  close();
}

async function openDownloadPage() {
  if (!current()) return;
  await updates.openDownloadPage();
}

async function runPrimary() {
  if (!current() || updates.phase === "downloading") return;
  try {
    await updates.primaryAction();
  } catch {
    // Store surfaces toast / status; keep dialog open for retry.
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-100"
    @keydown.esc="onEscape"
  >
    <div
      class="flex h-[min(560px,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-popover shadow-lg animate-in zoom-in-95 duration-100"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-busy="busy"
    >
      <div class="flex items-center gap-2 border-b px-4 py-3">
        <h2 :id="titleId" class="text-sm font-semibold">{{ t("updates.centerTitle") }}</h2>
        <span
          class="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
          data-testid="update-badge"
        >
          {{ badgeText }}
        </span>
        <div class="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          :aria-label="t('common.close')"
          :disabled="busy && updates.phase === 'installing'"
          @click="close"
        >
          <X class="h-4 w-4" />
        </Button>
      </div>

      <div class="border-b px-4">
        <div
          class="inline-flex items-center gap-1.5 border-b-2 border-foreground py-2 text-xs font-medium"
          data-testid="update-product-tab"
        >
          <span>gitx</span>
          <span
            v-if="updates.updateAvailable"
            class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] text-background"
          >
            1
          </span>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <p class="text-xs text-muted-foreground">{{ summaryText }}</p>
        <div
          class="min-h-0 flex-1 overflow-auto rounded-md border bg-background p-3 text-xs leading-relaxed whitespace-pre-wrap"
          data-testid="update-notes"
        >
          {{ notes }}
        </div>
        <p role="status" class="text-xs text-muted-foreground" data-testid="update-status">
          {{ updates.statusText || t("updates.checkHint") }}
        </p>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
        <Button
          size="sm"
          variant="ghost"
          :disabled="!updates.updateAvailable || busy"
          @click="ignoreVersion"
        >
          {{ t("updates.ignoreVersion") }}
        </Button>
        <Button size="sm" variant="outline" :disabled="!updates.latest" @click="openDownloadPage">
          {{ t("updates.openDownloadPage") }}
        </Button>
        <Button
          size="sm"
          :disabled="!updates.updateAvailable || updates.phase === 'downloading'"
          @click="runPrimary"
        >
          {{ updates.primaryActionLabel }}
        </Button>
      </div>
    </div>
  </div>
</template>
