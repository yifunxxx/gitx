<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { closeDialog } from "@/composables/useDialog";
import { useSettingsStore } from "@/stores/settingsStore";
import { getBackend } from "@/lib/backend";
import type { AppSettings } from "@/lib/backend";
import { toast } from "@/composables/useToast";
import { formatGitDetectError } from "@/lib/errors";
import { SETTINGS_PAGES, getByPath, setByPath, matchField, type SettingField } from "./schema";
import KeymapPanel from "./KeymapPanel.vue";
import { cloneJson } from "@/lib/clone";

const settings = useSettingsStore();
const { t } = useI18n();

const search = ref("");
const activePageId = ref("appearance");
const draft = reactive(cloneJson(settings.settings ?? settings.emptySettings())) as AppSettings;
const dirty = ref(false);
const testingGit = ref(false);
const gitTestResult = ref<string | null>(null);
const gitTestOk = ref(false);

watch(
  () => settings.settings,
  (s) => {
    if (!s || dirty.value) return;
    Object.assign(draft, cloneJson(s));
  },
);

const pages = SETTINGS_PAGES;

const activePage = computed(() => pages.find((p) => p.id === activePageId.value) ?? pages[0]!);

const filteredFields = computed(() => {
  const page = activePage.value;
  if (page.id === "keymap") return [];
  return page.fields.filter((f) => matchField(f, search.value, t));
});

const pageHits = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return new Set(pages.map((p) => p.id));
  const hits = new Set<string>();
  for (const page of pages) {
    if (t(page.titleKey).toLowerCase().includes(q) || page.id.includes(q)) {
      hits.add(page.id);
      continue;
    }
    if (page.fields.some((f) => matchField(f, q, t))) hits.add(page.id);
  }
  return hits;
});

watch(search, () => {
  const hits = pageHits.value;
  if (!hits.has(activePageId.value)) {
    const first = pages.find((p) => hits.has(p.id));
    if (first) activePageId.value = first.id;
  }
});

function markDirty() {
  dirty.value = true;
}

function onFieldChange(field: SettingField, value: unknown) {
  setByPath(draft as unknown as Record<string, unknown>, field.path, value);
  markDirty();
  // Live-preview appearance / locale while editing
  if (field.path.startsWith("appearance.") || field.path === "locale") {
    settings.previewAppearance(draft);
  }
}

function fieldValue(field: SettingField): unknown {
  return getByPath(draft, field.path);
}

function onStringListInput(field: SettingField, raw: string) {
  const list = raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  onFieldChange(field, list);
}

async function testGitPath() {
  testingGit.value = true;
  gitTestResult.value = null;
  gitTestOk.value = false;
  try {
    const path = (draft.gitExecutable || "").trim() || null;
    const result = path
      ? await getBackend().gitTestExecutable(path)
      : await getBackend().gitDetect();
    gitTestOk.value = true;
    gitTestResult.value = `${result.path} (${result.version})`;
    toast({ title: t("settings.gitTestOk"), description: gitTestResult.value });
  } catch (err) {
    gitTestOk.value = false;
    const msg = formatGitDetectError(err, t("settings.gitNotFound"));
    gitTestResult.value = msg;
    toast({ title: t("settings.gitTestFail"), description: msg });
  } finally {
    testingGit.value = false;
  }
}

async function apply() {
  await settings.save(cloneJson(draft));
  dirty.value = false;
  toast({ title: t("settings.applied") });
}

async function ok() {
  await apply();
  closeDialog(true);
}

function cancel() {
  if (settings.settings) {
    settings.previewAppearance(settings.settings);
  }
  closeDialog(false);
}

function onKeymapPatch(overrides: AppSettings["keymapOverrides"]) {
  draft.keymapOverrides = overrides;
  markDirty();
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-100"
    @keydown.esc="cancel"
  >
    <div
      class="flex h-[min(720px,90vh)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border bg-popover shadow-lg animate-in zoom-in-95 duration-100"
      role="dialog"
      aria-modal="true"
      :aria-label="t('settings.title')"
    >
      <div class="flex items-center gap-3 border-b px-4 py-3">
        <h2 class="text-sm font-semibold">{{ t("settings.title") }}</h2>
        <input
          v-model="search"
          type="search"
          class="h-8 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          :placeholder="t('settings.search')"
        />
      </div>

      <div class="flex min-h-0 flex-1">
        <nav class="w-48 shrink-0 overflow-auto border-r bg-muted/30 p-2 text-xs">
          <button
            v-for="page in pages"
            :key="page.id"
            type="button"
            class="mb-0.5 flex w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-40"
            :class="activePageId === page.id ? 'bg-accent font-medium' : ''"
            :disabled="!pageHits.has(page.id)"
            @click="activePageId = page.id"
          >
            {{ t(page.titleKey) }}
          </button>
        </nav>

        <div class="min-h-0 min-w-0 flex-1 overflow-auto p-4">
          <h3 class="mb-3 text-sm font-medium">{{ t(activePage.titleKey) }}</h3>

          <KeymapPanel v-if="activePage.id === 'keymap'" :draft="draft" @patch="onKeymapPatch" />

          <div v-else class="space-y-1">
            <div
              v-for="field in filteredFields"
              :key="field.id"
              class="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-3 border-b border-border/40 py-1.5 last:border-0"
            >
              <div class="text-xs font-medium leading-5">{{ t(field.titleKey) }}</div>

              <div class="flex flex-col gap-1">
                <Select
                  v-if="field.control.kind === 'select'"
                  :model-value="String(fieldValue(field) ?? '')"
                  @update:model-value="(v) => onFieldChange(field, String(v ?? ''))"
                >
                  <SelectTrigger>
                    <SelectValue :placeholder="t(field.titleKey)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="opt in field.control.options"
                      :key="opt.value"
                      :value="opt.value"
                    >
                      {{ t(opt.labelKey) }}
                    </SelectItem>
                  </SelectContent>
                </Select>

                <label
                  v-else-if="field.control.kind === 'boolean'"
                  class="flex h-8 items-center gap-2 text-xs"
                >
                  <input
                    type="checkbox"
                    :checked="Boolean(fieldValue(field))"
                    @change="onFieldChange(field, ($event.target as HTMLInputElement).checked)"
                  />
                  {{ Boolean(fieldValue(field)) ? t("settings.on") : t("settings.off") }}
                </label>

                <input
                  v-else-if="field.control.kind === 'number'"
                  type="number"
                  class="h-8 rounded-md border bg-background px-2 text-xs"
                  :min="field.control.min"
                  :max="field.control.max"
                  :step="field.control.step"
                  :value="Number(fieldValue(field) ?? 0)"
                  @change="onFieldChange(field, Number(($event.target as HTMLInputElement).value))"
                />

                <div v-else-if="field.control.kind === 'path'" class="flex gap-2">
                  <input
                    type="text"
                    class="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs"
                    :placeholder="t('settings.gitPathPlaceholder')"
                    :value="String(fieldValue(field) ?? '')"
                    @change="
                      onFieldChange(field, ($event.target as HTMLInputElement).value || null)
                    "
                  />
                  <Button size="sm" variant="outline" :disabled="testingGit" @click="testGitPath">
                    {{ t("settings.test") }}
                  </Button>
                </div>

                <input
                  v-else-if="field.control.kind === 'stringList'"
                  type="text"
                  class="h-8 rounded-md border bg-background px-2 text-xs"
                  :placeholder="field.control.placeholder"
                  :value="
                    Array.isArray(fieldValue(field))
                      ? (fieldValue(field) as string[]).join(', ')
                      : ''
                  "
                  @change="onStringListInput(field, ($event.target as HTMLInputElement).value)"
                />

                <input
                  v-else
                  type="text"
                  class="h-8 rounded-md border bg-background px-2 text-xs"
                  :placeholder="
                    field.control.kind === 'text' ? field.control.placeholder : undefined
                  "
                  :value="String(fieldValue(field) ?? '')"
                  @change="onFieldChange(field, ($event.target as HTMLInputElement).value)"
                />

                <p
                  v-if="field.id === 'gitExecutable' && gitTestResult"
                  class="font-mono text-[10px]"
                  :class="gitTestOk ? 'text-muted-foreground' : 'text-destructive'"
                >
                  {{ gitTestResult }}
                </p>
              </div>
            </div>

            <p v-if="search && !filteredFields.length" class="text-xs text-muted-foreground">
              {{ t("settings.noMatches") }}
            </p>
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-2 border-t px-4 py-3">
        <Button variant="ghost" size="sm" @click="cancel">
          {{ t("common.cancel") }}
        </Button>
        <Button variant="outline" size="sm" :disabled="!dirty" @click="apply">
          {{ t("common.apply") }}
        </Button>
        <Button size="sm" @click="ok">{{ t("common.ok") }}</Button>
      </div>
    </div>
  </div>
</template>
