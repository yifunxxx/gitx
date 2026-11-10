<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { getBackend, type ShelfPreview } from "@/lib/backend";
import { formatErrorMessage } from "@/lib/errors";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import ShelfPatchView from "./ShelfPatchView.vue";

const props = defineProps<{
  path: string;
  id: string;
  deleted: boolean;
  message: string;
  navigation: number;
}>();
const { t } = useI18n();
const workspace = useWorkspaceStore();
const dialogId = useDialogState().value?.id;
const result = shallowRef<ShelfPreview | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
let alive = true;
const current = () =>
  alive && workspace.repoPath === props.path && workspace.navigationToken() === props.navigation;
function close() {
  alive = false;
  closeDialog(null, dialogId);
}
watch(
  () => [workspace.repoPath, workspace.navigationToken()],
  () => {
    if (!current()) close();
  },
  { flush: "sync" },
);
onBeforeUnmount(() => {
  alive = false;
});
async function load() {
  if (loading.value) return;
  if (!current()) {
    close();
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const preview = await getBackend().shelfPreview({
      path: props.path,
      id: props.id,
      deleted: props.deleted,
    });
    if (current()) result.value = preview;
  } catch (e) {
    if (current()) error.value = formatErrorMessage(e);
  } finally {
    if (current()) loading.value = false;
  }
}
onMounted(() => void load());
</script>

<template>
  <div class="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
    <section
      class="flex h-[85vh] w-full max-w-6xl min-w-0 flex-col overflow-hidden rounded-lg border bg-popover shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shelf-preview-title"
    >
      <header class="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <h2
          id="shelf-preview-title"
          class="min-w-0 flex-1 truncate text-sm font-semibold"
          :title="result?.entry.message ?? message"
        >
          {{ t("shelf.preview") }} · {{ result?.entry.message ?? message }}
        </h2>
        <span v-if="deleted" class="shrink-0 text-xs text-muted-foreground">{{
          t("shelf.recentlyDeleted")
        }}</span>
        <Button size="sm" variant="ghost" @click="close">{{ t("common.close") }}</Button>
      </header>
      <p class="shrink-0 px-4 py-2 text-xs text-muted-foreground">{{ t("shelf.previewHint") }}</p>
      <div v-if="loading" role="status" class="p-4 text-xs">{{ t("common.loading") }}</div>
      <div v-else-if="error" role="alert" class="space-y-3 p-4 text-xs">
        <p class="text-destructive">{{ error }}</p>
        <Button size="sm" variant="outline" @click="load">{{ t("diff.retry") }}</Button>
      </div>
      <template v-else-if="result">
        <p v-if="result.truncated" role="status" class="px-4 pb-2 text-xs text-warning">
          {{ t("shelf.previewTruncated") }}
        </p>
        <p v-if="result.lossy" role="status" class="px-4 pb-2 text-xs text-warning">
          {{ t("shelf.previewLossy") }}
        </p>
        <p v-if="result.entry.binary" class="px-4 pb-2 text-xs text-muted-foreground">
          {{ t("shelf.previewBinary") }}
        </p>
        <ShelfPatchView
          v-if="result.patch"
          class="min-h-0 flex-1 border-t"
          :text="result.patch"
          :label="t('shelf.preview')"
        />
        <p v-else class="p-4 text-xs text-muted-foreground">{{ t("shelf.noPatchChanges") }}</p>
      </template>
    </section>
  </div>
</template>
