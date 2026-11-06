<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { listActions, shortcutFor, detectPlatform } from "@/actions";
import type { AppSettings } from "@/lib/backend";

const props = defineProps<{
  draft: AppSettings;
}>();

const emit = defineEmits<{
  patch: [overrides: Record<string, string[]>];
}>();

const { t } = useI18n();
const filter = ref("");
const recordingId = ref<string | null>(null);
const platform = detectPlatform();

const rows = computed(() => {
  const q = filter.value.trim().toLowerCase();
  const overrides = props.draft.keymapOverrides ?? {};
  return listActions()
    .map((a) => {
      const chords = overrides[a.id]?.length ? overrides[a.id]! : shortcutFor(a, platform);
      return { id: a.id, title: a.title, chords };
    })
    .filter((r) => !q || r.id.toLowerCase().includes(q) || r.title.toLowerCase().includes(q))
    .sort((a, b) => a.id.localeCompare(b.id));
});

function formatChord(chord: string): string {
  const isMac = platform === "mac";
  return chord
    .split("+")
    .map((p) => {
      const x = p.toLowerCase();
      if (x === "mod") return isMac ? "⌘" : "Ctrl";
      if (x === "shift") return isMac ? "⇧" : "Shift";
      if (x === "alt") return isMac ? "⌥" : "Alt";
      if (x === "meta") return "⌘";
      if (x === "ctrl") return "Ctrl";
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join(isMac ? "" : "+");
}

function chordFromEvent(e: KeyboardEvent): string | null {
  if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return null;
  const parts: string[] = [];
  const isMac = platform === "mac";
  if (isMac ? e.metaKey : e.ctrlKey) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (key === "escape") return null;
  parts.push(key === " " ? "space" : key);
  return parts.join("+");
}

function onRecordKey(e: KeyboardEvent) {
  if (!recordingId.value) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === "Escape") {
    recordingId.value = null;
    return;
  }
  const chord = chordFromEvent(e);
  if (!chord) return;
  const next = { ...(props.draft.keymapOverrides ?? {}) };
  next[recordingId.value] = [chord];
  emit("patch", next);
  recordingId.value = null;
}

function resetOne(id: string) {
  const next = { ...(props.draft.keymapOverrides ?? {}) };
  delete next[id];
  emit("patch", next);
}

function resetAll() {
  emit("patch", {});
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2" @keydown.capture="onRecordKey">
    <div class="flex items-center gap-2">
      <input
        v-model="filter"
        type="search"
        class="h-8 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        :placeholder="t('settings.keymap.search')"
      />
      <Button size="sm" variant="outline" @click="resetAll">
        {{ t("settings.keymap.resetAll") }}
      </Button>
    </div>
    <p class="text-[11px] text-muted-foreground">{{ t("settings.keymap.hint") }}</p>
    <div class="min-h-0 flex-1 overflow-auto rounded-md border">
      <table class="w-full text-left text-xs">
        <thead class="sticky top-0 bg-muted/80 backdrop-blur">
          <tr class="border-b text-muted-foreground">
            <th class="px-2 py-1.5 font-medium">{{ t("settings.keymap.action") }}</th>
            <th class="px-2 py-1.5 font-medium">{{ t("settings.keymap.shortcut") }}</th>
            <th class="w-28 px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" class="border-b border-border/60 hover:bg-accent/40">
            <td class="px-2 py-1.5">
              <div class="font-medium">{{ row.title }}</div>
              <div class="font-mono text-[10px] text-muted-foreground">{{ row.id }}</div>
            </td>
            <td class="px-2 py-1.5">
              <span
                v-if="recordingId === row.id"
                class="rounded bg-info/15 px-1.5 py-0.5 text-info"
              >
                {{ t("settings.keymap.recording") }}
              </span>
              <kbd
                v-else-if="row.chords.length"
                class="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]"
              >
                {{ row.chords.map(formatChord).join(" / ") }}
              </kbd>
              <span v-else class="text-muted-foreground">—</span>
            </td>
            <td class="px-2 py-1.5 text-right">
              <Button size="xs" variant="ghost" @click="recordingId = row.id">
                {{ t("settings.keymap.rebind") }}
              </Button>
              <Button
                v-if="(draft.keymapOverrides ?? {})[row.id]"
                size="xs"
                variant="ghost"
                @click="resetOne(row.id)"
              >
                {{ t("settings.keymap.reset") }}
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
