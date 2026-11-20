<script setup lang="ts">
import { computed } from "vue";
import { Check, FolderOpen } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorkspaceOpen } from "@/composables/useWorkspaceOpen";

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const workspace = useWorkspaceStore();
const { pending, openFolder, openRecent } = useWorkspaceOpen();
function pathKey(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}
const recent = computed(() => {
  const seen = new Set<string>();
  return workspace.recent
    .filter((path) => {
      const key = pathKey(path);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
});
const isCurrent = (path: string) =>
  !!workspace.folderPath && pathKey(path) === pathKey(workspace.folderPath);
const name = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || path;
async function choose(path?: string) {
  if (pending.value || (path && isCurrent(path))) return;
  emit("close");
  if (path) await openRecent(path);
  else await openFolder();
}
</script>

<template>
  <button
    type="button"
    role="menuitem"
    :disabled="pending"
    class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent focus-visible:bg-accent disabled:opacity-50"
    @click="choose()"
  >
    <FolderOpen class="h-4 w-4 shrink-0" />{{ t("welcome.open") }}
  </button>
  <div role="separator" class="my-1 border-t" />
  <div class="px-2 py-1 text-[11px] font-medium text-muted-foreground">
    {{ t("toolbar.recentProjects") }}
  </div>
  <p v-if="!recent.length" class="px-2 py-3 text-xs text-muted-foreground">
    {{ t("welcome.noRecent") }}
  </p>
  <button
    v-for="path in recent"
    :key="path"
    type="button"
    role="menuitem"
    :disabled="pending || isCurrent(path)"
    :aria-current="isCurrent(path) ? 'page' : undefined"
    :aria-label="path"
    :title="path"
    class="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent focus-visible:bg-accent disabled:opacity-60"
    @click="choose(path)"
  >
    <FolderOpen class="h-4 w-4 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1"
      ><span class="block truncate text-[13px]">{{ name(path) }}</span
      ><span class="block truncate text-[11px] text-muted-foreground">{{ path }}</span></span
    >
    <Check
      v-if="isCurrent(path)"
      class="h-3.5 w-3.5 shrink-0"
      :aria-label="t('toolbar.currentProject')"
    />
  </button>
</template>
