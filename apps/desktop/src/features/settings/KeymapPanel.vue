<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { listActions } from "@/actions/registry";
import {
  chordFromEvent,
  detectPlatform,
  findShortcutConflicts,
  formatShortcut,
  isShortcutEvent,
  reservedShortcut,
  shortcutFor,
} from "@/actions/keymap";
import { resolveActionTitle } from "@/actions/titles";
import type { AppSettings } from "@/lib/backend";

const props = defineProps<{ draft: AppSettings; disabled?: boolean }>();
const emit = defineEmits<{ patch: [overrides: AppSettings["keymapOverrides"]] }>();
const { t } = useI18n();
const filter = ref("");
const recordingId = ref<string | null>(null);
const error = ref<string | null>(null);
const panel = ref<HTMLElement | null>(null);
const platform = detectPlatform();
let focusVersion = 0;

function bindingError(id: string, chords: string[], overrides = props.draft.keymapOverrides ?? {}) {
  for (const chord of chords) {
    const reserved = reservedShortcut(chord, platform);
    if (reserved)
      return t("settings.keymap.reserved", {
        shortcut: formatShortcut(chord, platform),
        action: t(reserved),
      });
    const conflicts = findShortcutConflicts(id, chord, overrides, platform);
    if (conflicts.length)
      return t("settings.keymap.conflict", {
        shortcut: formatShortcut(chord, platform),
        actions: listActions()
          .filter((action) => conflicts.includes(action.id))
          .map((action) => resolveActionTitle(action, t))
          .join("、"),
      });
  }
  return null;
}

const allRows = computed(() =>
  listActions()
    .map((action) => {
      const chords = shortcutFor(action, platform, props.draft.keymapOverrides ?? {});
      return {
        id: action.id,
        title: resolveActionTitle(action, t),
        fallback: action.title,
        chords,
        warning: bindingError(action.id, chords),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id)),
);
const rows = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return allRows.value.filter(
    (row) =>
      !q ||
      [
        row.id,
        row.title,
        row.fallback,
        ...row.chords.map((chord) => formatShortcut(chord, platform)),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
  );
});

async function stopRecording(restoreFocus = false) {
  const id = recordingId.value;
  const version = ++focusVersion;
  recordingId.value = null;
  if (!restoreFocus || !id) return;
  await nextTick();
  if (version !== focusVersion) return;
  Array.from(panel.value?.querySelectorAll<HTMLButtonElement>("[data-keymap-rebind]") ?? [])
    .find((button) => button.dataset.keymapRebind === id)
    ?.focus({ preventScroll: true });
}
async function startRecording(id: string) {
  if (props.disabled) return;
  error.value = null;
  recordingId.value = id;
  const version = ++focusVersion;
  await nextTick();
  if (version === focusVersion && recordingId.value === id)
    panel.value?.querySelector<HTMLInputElement>("[data-keymap-recorder]")?.focus();
}
function onRecordKey(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.repeat) event.preventDefault();
  if (props.disabled || !recordingId.value || !isShortcutEvent(event)) return;
  if (event.key === "Tab") {
    void stopRecording();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    error.value = null;
    void stopRecording(true);
    return;
  }
  const chord = chordFromEvent(event, platform);
  event.preventDefault();
  if (!chord) return;
  const warning = bindingError(recordingId.value, [chord]);
  if (warning) {
    error.value = warning;
    return;
  }
  emit("patch", { ...props.draft.keymapOverrides, [recordingId.value]: [chord] });
  error.value = null;
  void stopRecording(true);
}
function resetOne(id: string) {
  if (props.disabled) return;
  void stopRecording();
  const next = { ...props.draft.keymapOverrides };
  delete next[id];
  const action = listActions().find((action) => action.id === id)!;
  error.value = bindingError(id, shortcutFor(action, platform, next), next);
  if (!error.value) emit("patch", next);
}
function removeBinding(id: string) {
  if (props.disabled) return;
  void stopRecording();
  error.value = null;
  emit("patch", { ...props.draft.keymapOverrides, [id]: [] });
}
function resetAll() {
  if (props.disabled) return;
  void stopRecording();
  error.value = null;
  emit("patch", {});
}
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) void stopRecording();
  },
);
watch(filter, () => {
  void stopRecording();
  error.value = null;
});
</script>

<template>
  <div ref="panel" class="flex min-h-0 flex-1 flex-col gap-2">
    <div class="flex items-center gap-2">
      <input
        v-model="filter"
        type="search"
        class="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        :placeholder="t('settings.keymap.search')"
        :aria-label="t('settings.keymap.search')"
      />
      <Button size="sm" variant="outline" :disabled="disabled" @click="resetAll">{{
        t("settings.keymap.resetAll")
      }}</Button>
    </div>
    <p class="text-[11px] text-muted-foreground">{{ t("settings.keymap.hint") }}</p>
    <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
    <div class="min-h-0 flex-1 overflow-auto rounded-md border">
      <table class="w-full table-fixed text-left text-xs">
        <thead class="sticky top-0 bg-muted">
          <tr class="border-b text-muted-foreground">
            <th class="w-[38%] px-2 py-1.5 font-medium">{{ t("settings.keymap.action") }}</th>
            <th class="w-[30%] px-2 py-1.5 font-medium">{{ t("settings.keymap.shortcut") }}</th>
            <th class="px-2 py-1.5">
              <span class="sr-only">{{ t("settings.keymap.edit") }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            :data-action-id="row.id"
            class="border-b border-border/60 hover:bg-accent/40"
          >
            <td class="break-words px-2 py-1">
              <div class="font-medium leading-5">{{ row.title }}</div>
              <div class="break-all font-mono text-[10px] leading-4 text-muted-foreground">
                {{ row.id }}
              </div>
            </td>
            <td class="px-2 py-1">
              <input
                v-if="recordingId === row.id"
                data-keymap-recorder
                readonly
                class="h-8 w-full rounded border border-info bg-background px-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                :aria-label="t('settings.keymap.recordFor', { action: row.title })"
                :placeholder="t('settings.keymap.recording')"
                @keydown="onRecordKey"
                @blur="stopRecording()"
              />
              <kbd
                v-else-if="row.chords.length"
                class="break-words rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]"
              >
                {{ row.chords.map((chord) => formatShortcut(chord, platform)).join(" / ") }}
              </kbd>
              <span v-else class="text-muted-foreground">{{ t("settings.keymap.unbound") }}</span>
              <p v-if="row.warning" class="mt-1 text-[11px] text-destructive">{{ row.warning }}</p>
            </td>
            <td class="px-2 py-1">
              <div class="flex flex-wrap justify-end gap-0.5">
                <Button
                  size="xs"
                  variant="ghost"
                  :disabled="disabled"
                  :data-keymap-rebind="row.id"
                  :aria-label="t('settings.keymap.rebindFor', { action: row.title })"
                  @click="startRecording(row.id)"
                >
                  {{ t("settings.keymap.rebind") }}
                </Button>
                <Button
                  v-if="row.chords.length"
                  size="xs"
                  variant="ghost"
                  :disabled="disabled"
                  :aria-label="t('settings.keymap.removeFor', { action: row.title })"
                  @click="removeBinding(row.id)"
                >
                  {{ t("settings.keymap.remove") }}
                </Button>
                <Button
                  v-if="(draft.keymapOverrides ?? {})[row.id]"
                  size="xs"
                  variant="ghost"
                  :disabled="disabled"
                  :aria-label="t('settings.keymap.resetFor', { action: row.title })"
                  @click="resetOne(row.id)"
                >
                  {{ t("settings.keymap.reset") }}
                </Button>
              </div>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="3" class="px-2 py-4 text-muted-foreground">
              {{ t("settings.noMatches") }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
