<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { closeDialog, useDialogStack, useDialogState } from "@/composables/useDialog";
import { useSettingsStore } from "@/stores/settingsStore";
import { getBackend } from "@/lib/backend";
import type { AppSettings } from "@/lib/backend";
import { toast } from "@/composables/useToast";
import { formatErrorMessage, formatGitDetectError } from "@/lib/errors";
import {
  SETTINGS_PAGES,
  getByPath,
  setByPath,
  matchField,
  type SettingField,
} from "./schema";
import KeymapPanel from "./KeymapPanel.vue";
import AboutUpdatesPanel from "./AboutUpdatesPanel.vue";
import { cloneJson } from "@/lib/clone";

const settings = useSettingsStore();
const { t } = useI18n();
const dialog = useDialogState();
const stack = useDialogStack();
const dialogId = dialog.value?.id;
const idPrefix = useId();
let disposed = false;
const present = () => !disposed && stack.value.some((entry) => entry.id === dialogId);
const current = () => present() && dialog.value?.id === dialogId;

const search = ref("");
const activePageId = ref("appearance");
const draft = reactive(
  cloneJson(settings.settings ?? settings.emptySettings()),
) as AppSettings;
const dirty = ref(false);
const saving = ref(false);
const saveError = ref<string | null>(null);
let revision = 0;
const testingGit = ref(false);
let gitTestRequest = 0;
const gitTestResult = ref<string | null>(null);
const gitTestOk = ref(false);
const preview = settings.beginAppearancePreview(draft);

onBeforeUnmount(() => {
  disposed = true;
  gitTestRequest++;
  preview.end();
});

watch(
  () => settings.settings,
  (s) => {
    if (!s || dirty.value) return;
    Object.assign(draft, cloneJson(s));
    preview.update(draft);
  },
);

const pages = SETTINGS_PAGES;

const activePage = computed(() => pages.find((p) => p.id === activePageId.value) ?? pages[0]!);

const filteredFields = computed(() => {
  const page = activePage.value;
  if (page.id === "keymap" || page.id === "about") return [];
  if (matchesPage(page.id, page.titleKey)) return page.fields;
  return page.fields.filter((f) => matchField(f, search.value, t));
});

function matchesPage(id: string, titleKey: string) {
  const q = search.value.trim().toLowerCase();
  return !q || t(titleKey).toLowerCase().includes(q) || id.includes(q);
}

const pageHits = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return new Set(pages.map((p) => p.id));
  const hits = new Set<string>();
  for (const page of pages) {
    if (matchesPage(page.id, page.titleKey)) {
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
  revision++;
  saveError.value = null;
}

function onFieldChange(field: SettingField, value: unknown) {
  if (!current() || saving.value) return;
  setByPath(draft as unknown as Record<string, unknown>, field.path, value);
  markDirty();
  // Live-preview appearance / locale while editing
  if (field.path.startsWith("appearance.") || field.path === "locale") {
    preview.update(draft);
  }
}

const numberErrors = computed(() => {
  const errors: Record<string, string> = {};
  for (const field of pages.flatMap((page) => page.fields)) {
    const control = field.control;
    if (control.kind !== "number") continue;
    const value = fieldValue(field);
    if (typeof value !== "number" || !Number.isFinite(value)
      || (control.min != null && value < control.min)
      || (control.max != null && value > control.max)
      || (control.step != null && (value - (control.min ?? 0)) % control.step !== 0)) {
      errors[field.id] = t("settings.invalidNumber", { min: control.min, max: control.max });
    }
  }
  return errors;
});
const invalid = computed(() => Object.keys(numberErrors.value).length > 0);

watch(() => draft.gitExecutable, () => {
  gitTestRequest++;
  testingGit.value = false;
  gitTestResult.value = null;
}, { flush: "sync" });

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
  if (!current() || testingGit.value || saving.value) return;
  const request = ++gitTestRequest;
  const valid = () => present() && request === gitTestRequest;
  testingGit.value = true;
  gitTestResult.value = null;
  gitTestOk.value = false;
  try {
    const path = (draft.gitExecutable || "").trim();
    const result = await getBackend().gitTestExecutable(path);
    if (!valid()) return;
    gitTestOk.value = true;
    gitTestResult.value = `${result.path} (${result.version})`;
  } catch (err) {
    if (!valid()) return;
    gitTestOk.value = false;
    const msg = formatGitDetectError(err, t("settings.gitNotFound"));
    gitTestResult.value = msg;
  } finally {
    if (valid()) testingGit.value = false;
  }
}

async function apply(closeAfter = false) {
  if (!current() || saving.value || invalid.value) return;
  if (!dirty.value) {
    if (closeAfter) closeDialog(true, dialogId);
    return;
  }
  saving.value = true;
  saveError.value = null;
  const submittedRevision = revision;
  try {
    const saved = await settings.save(cloneJson(draft));
    if (!present() || submittedRevision !== revision) return;
    Object.assign(draft, cloneJson(saved));
    dirty.value = false;
    preview.update(draft);
    if (closeAfter) closeDialog(true, dialogId);
    else if (current()) toast({ title: t("settings.applied") });
  } catch (err) {
    if (present()) saveError.value = formatErrorMessage(err);
  } finally {
    saving.value = false;
  }
}

function cancel() {
  if (!current() || saving.value) return;
  closeDialog(false, dialogId);
}

function onEscape(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  cancel();
}

function onKeymapPatch(overrides: AppSettings["keymapOverrides"]) {
  if (!current() || saving.value) return;
  draft.keymapOverrides = overrides;
  markDirty();
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-100"
    @keydown.esc="onEscape"
  >
    <div
      class="flex h-[min(720px,90vh)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border bg-popover shadow-lg animate-in zoom-in-95 duration-100"
      role="dialog"
      aria-modal="true"
      :aria-label="t('settings.title')"
      :aria-busy="saving"
    >
      <div class="flex items-center gap-3 border-b px-4 py-3">
        <h2 class="text-sm font-semibold">{{ t("settings.title") }}</h2>
        <input
          v-model="search"
          type="search"
          class="h-8 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          :placeholder="t('settings.search')"
          :aria-label="t('settings.search')"
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
            :aria-current="activePageId === page.id ? 'page' : undefined"
            @click="activePageId = page.id"
          >
            {{ t(page.titleKey) }}
          </button>
        </nav>

        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-4">
          <h3 class="mb-3 text-sm font-medium">{{ t(activePage.titleKey) }}</h3>

          <KeymapPanel
            v-if="activePage.id === 'keymap'"
            :draft="draft"
            :disabled="saving"
            @patch="onKeymapPatch"
          />

          <AboutUpdatesPanel v-else-if="activePage.id === 'about'" :disabled="saving" />

          <fieldset v-else class="min-w-0 space-y-1" :disabled="saving">
            <div
              v-for="field in filteredFields"
              :key="field.id"
              class="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-3 border-b border-border/40 py-1.5 last:border-0"
            >
              <label :id="`${idPrefix}-${field.id}-label`" :for="`${idPrefix}-${field.id}`" class="text-xs font-medium leading-5">{{ t(field.titleKey) }}</label>

              <div class="flex flex-col gap-1">
                <Select
                  v-if="field.control.kind === 'select'"
                  :model-value="String(fieldValue(field) ?? '')"
                  :disabled="saving"
                  @update:model-value="(v) => onFieldChange(field, String(v ?? ''))"
                >
                  <SelectTrigger :id="`${idPrefix}-${field.id}`" :aria-labelledby="`${idPrefix}-${field.id}-label`">
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
                    :id="`${idPrefix}-${field.id}`"
                    :aria-labelledby="`${idPrefix}-${field.id}-label`"
                    :checked="Boolean(fieldValue(field))"
                    @change="
                      onFieldChange(
                        field,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                  {{
                    Boolean(fieldValue(field))
                      ? t("settings.on")
                      : t("settings.off")
                  }}
                </label>

                <input
                  v-else-if="field.control.kind === 'number'"
                  type="number"
                  :id="`${idPrefix}-${field.id}`"
                  :aria-invalid="Boolean(numberErrors[field.id])"
                  :aria-describedby="numberErrors[field.id] ? `${idPrefix}-${field.id}-error` : undefined"
                  class="h-8 rounded-md border bg-background px-2 text-xs"
                  :min="field.control.min"
                  :max="field.control.max"
                  :step="field.control.step"
                  :value="Number(fieldValue(field) ?? 0)"
                  @input="
                    onFieldChange(
                      field,
                      ($event.target as HTMLInputElement).valueAsNumber,
                    )
                  "
                />

                <div
                  v-else-if="field.control.kind === 'path'"
                  class="flex gap-2"
                >
                  <input
                    type="text"
                    :id="`${idPrefix}-${field.id}`"
                    class="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs"
                    :placeholder="t('settings.gitPathPlaceholder')"
                    :value="String(fieldValue(field) ?? '')"
                    @input="
                      onFieldChange(
                        field,
                        ($event.target as HTMLInputElement).value || null,
                      )
                    "
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    :disabled="testingGit"
                    @click="testGitPath"
                  >
                    {{ t("settings.test") }}
                  </Button>
                </div>

                <input
                  v-else-if="field.control.kind === 'stringList'"
                  type="text"
                  :id="`${idPrefix}-${field.id}`"
                  class="h-8 rounded-md border bg-background px-2 text-xs"
                  :placeholder="field.control.placeholder"
                  :value="
                    Array.isArray(fieldValue(field))
                      ? (fieldValue(field) as string[]).join(', ')
                      : ''
                  "
                  @change="
                    onStringListInput(
                      field,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />

                <input
                  v-else
                  type="text"
                  :id="`${idPrefix}-${field.id}`"
                  class="h-8 rounded-md border bg-background px-2 text-xs"
                  :placeholder="
                    field.control.kind === 'text'
                      ? field.control.placeholder
                      : undefined
                  "
                  :value="String(fieldValue(field) ?? '')"
                  @input="
                    onFieldChange(
                      field,
                      ($event.target as HTMLInputElement).value,
                    )
                  "
                />

                <p
                  v-if="numberErrors[field.id]"
                  :id="`${idPrefix}-${field.id}-error`"
                  role="alert"
                  class="text-xs text-destructive"
                >{{ numberErrors[field.id] }}</p>

                <p
                  v-if="field.id === 'gitExecutable' && gitTestResult"
                  role="status"
                  class="font-mono text-[10px]"
                  :class="gitTestOk ? 'text-muted-foreground' : 'text-destructive'"
                >
                  {{ gitTestResult }}
                </p>
              </div>
            </div>

            <p
              v-if="search && !filteredFields.length"
              class="text-xs text-muted-foreground"
            >
              {{ t("settings.noMatches") }}
            </p>
          </fieldset>
        </div>
      </div>

      <p v-if="saveError" role="alert" class="px-4 pb-2 text-xs text-destructive">{{ t("settings.saveFailed") }}: {{ saveError }}</p>
      <div class="flex items-center justify-end gap-2 border-t px-4 py-3">
        <span v-if="saving" role="status" class="mr-auto text-xs text-muted-foreground">{{ t("settings.saving") }}</span>
        <Button variant="ghost" size="sm" :disabled="saving" @click="cancel">
          {{ t("common.cancel") }}
        </Button>
        <Button variant="outline" size="sm" :disabled="!dirty || saving || invalid" @click="apply()">
          {{ t("common.apply") }}
        </Button>
        <Button size="sm" :disabled="saving || invalid" @click="apply(true)">{{ t("common.ok") }}</Button>
      </div>
    </div>
  </div>
</template>
