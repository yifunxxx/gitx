<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import VirtualList from "@/components/common/VirtualList.vue";

export type PathChecklistItem = {
  path: string;
  origPath?: string | null;
  status?: string;
};

const props = withDefaults(
  defineProps<{
    files: PathChecklistItem[];
    modelValue: string[];
    disabled?: boolean;
  }>(),
  { disabled: false },
);
const emit = defineEmits<{ "update:modelValue": [paths: string[]] }>();
const { t } = useI18n();
const query = ref("");
const list = ref<{ el: HTMLElement | null; scrollToIndex: (index: number) => void } | null>(null);
const selected = computed(() => new Set(props.modelValue));
const filtered = computed(() => {
  const term = query.value.toLocaleLowerCase();
  if (!term) return props.files;
  return props.files.filter((file) =>
    `${file.path}\n${file.origPath ?? ""}`.toLocaleLowerCase().includes(term),
  );
});

watch(
  () => props.files.map((file) => file.path).join("\0"),
  () => {
    const allowed = new Set(props.files.map((file) => file.path));
    const next = props.modelValue.filter((path) => allowed.has(path));
    if (next.length !== props.modelValue.length) emit("update:modelValue", next);
  },
);

function setSelected(paths: Iterable<string>) {
  emit("update:modelValue", [...new Set(paths)]);
}
function toggle(path: string) {
  if (props.disabled) return;
  const next = new Set(selected.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  setSelected(next);
}
function selectVisible() {
  if (props.disabled) return;
  const next = new Set(selected.value);
  for (const file of filtered.value) next.add(file.path);
  setSelected(next);
}
function clearSelection() {
  if (props.disabled) return;
  setSelected([]);
}
async function moveFocus(event: KeyboardEvent, index: number) {
  const key = event.key;
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return;
  event.preventDefault();
  const next =
    key === "Home"
      ? 0
      : key === "End"
        ? filtered.value.length - 1
        : index + (key === "ArrowDown" ? 1 : -1);
  const target = Math.max(0, Math.min(filtered.value.length - 1, next));
  list.value?.scrollToIndex(target);
  await nextTick();
  list.value?.el?.querySelector<HTMLInputElement>(`[data-file-index="${target}"]`)?.focus();
}
</script>

<template>
  <div class="flex min-h-0 flex-col gap-2">
    <input
      v-model="query"
      type="search"
      :aria-label="t('rewrite.filterFiles')"
      :placeholder="t('rewrite.filterFiles')"
      :disabled="disabled"
      class="h-8 w-full rounded-md border bg-background px-2 text-xs"
    />
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <Button
        type="button"
        size="sm"
        variant="outline"
        :disabled="disabled || !filtered.length"
        @click="selectVisible"
        >{{ t("rewrite.selectVisible") }}</Button
      >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        :disabled="disabled || !selected.size"
        @click="clearSelection"
        >{{ t("rewrite.clearSelection") }}</Button
      >
      <span role="status" class="ml-auto text-muted-foreground">{{
        t("rewrite.selectedFiles", { selected: selected.size, total: files.length })
      }}</span>
    </div>
    <div class="flex h-[min(30vh,280px)] min-h-[96px] shrink-0 flex-col rounded-md border">
      <VirtualList
        ref="list"
        :items="filtered"
        :item-height="36"
        :get-key="(file: PathChecklistItem) => file.path"
      >
        <template #default="{ item: file, index }">
          <label
            class="flex h-full cursor-pointer items-center gap-2 px-2 text-xs hover:bg-accent focus-within:bg-accent"
            :title="file.origPath ? `${file.origPath} → ${file.path}` : file.path"
          >
            <input
              type="checkbox"
              :checked="selected.has(file.path)"
              :disabled="disabled"
              :aria-label="file.origPath ? `${file.origPath} → ${file.path}` : file.path"
              :data-file-index="index"
              @change="toggle(file.path)"
              @keydown="moveFocus($event, index)"
            />
            <span class="w-6 shrink-0 font-mono text-muted-foreground">{{
              file.status || "·"
            }}</span>
            <span class="truncate font-mono"
              ><template v-if="file.origPath">{{ file.origPath }} → </template
              >{{ file.path }}</span
            >
          </label>
        </template>
        <template #footer
          ><p v-if="!filtered.length" class="p-3 text-xs text-muted-foreground">
            {{ t("rewrite.noMatchingFiles") }}
          </p></template
        >
      </VirtualList>
    </div>
  </div>
</template>
