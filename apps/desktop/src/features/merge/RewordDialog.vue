<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { useRewriteStore } from "@/stores/rewriteStore";
import { getBackend } from "@/lib/backend";
import { useRewriteDialog } from "./useRewriteDialog";

const props = defineProps<{ sha: string }>();
const rewrite = useRewriteStore();
const { t } = useI18n();
const { path, busy, error, current, dismiss, showError, submit } = useRewriteDialog();
const message = ref("");
const loading = ref(true);
const loaded = ref(false);
const sha = props.sha;

async function load() {
  if (!path || !current()) return;
  loading.value = true;
  error.value = null;
  try {
    const d = await getBackend().logCommitDetails({ path, sha });
    if (!current()) return;
    message.value = d.body ? `${d.subject}\n\n${d.body}` : d.subject;
    loaded.value = true;
  } catch (reason) {
    showError(reason);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function ok() {
  if (loading.value || !loaded.value || !message.value.trim()) return;
  await submit(() => rewrite.reword(sha, message.value));
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    :aria-label="t('rewrite.rewordTitle')"
    :aria-busy="loading || busy"
    @keydown.esc.stop.prevent="dismiss"
  >
    <div
      class="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg border bg-popover p-4 shadow-lg"
    >
      <h2 class="text-sm font-semibold">{{ t("rewrite.rewordTitle") }}</h2>
      <p class="mt-1 font-mono text-[11px] text-muted-foreground">{{ sha.slice(0, 12) }}</p>
      <p v-if="loading" class="mt-2 text-xs text-muted-foreground">{{ t("common.loading") }}</p>
      <p v-if="error" role="alert" class="mt-2 text-xs text-destructive">{{ error }}</p>
      <Button
        v-if="error && !loaded"
        size="sm"
        variant="outline"
        :disabled="loading"
        @click="load"
        >{{ t("empty.retry") }}</Button
      >
      <textarea
        v-model="message"
        :aria-label="t('merge.commitMessage')"
        :disabled="loading || !loaded || busy"
        class="mt-3 min-h-[120px] w-full rounded-md border bg-background p-2 font-mono text-[12.5px]"
        spellcheck="false"
      />
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" :disabled="busy" @click="dismiss">{{
          t("common.cancel")
        }}</Button>
        <Button size="sm" :disabled="loading || !loaded || !message.trim() || busy" @click="ok">{{
          t("rewrite.reword")
        }}</Button>
      </div>
    </div>
  </div>
</template>
