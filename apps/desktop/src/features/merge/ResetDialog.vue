<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { useRewriteStore } from "@/stores/rewriteStore";
import { getBackend, type ResetMode, type ResetPreview } from "@/lib/backend";
import { useRewriteDialog } from "./useRewriteDialog";

const props = defineProps<{ target: string }>();
const rewrite = useRewriteStore();
const { t } = useI18n();
const { path, busy, error, current, dismiss, showError, submit } = useRewriteDialog();
const target = props.target;

const mode = ref<ResetMode>("mixed");
const preview = ref<ResetPreview | null>(null);
const confirmHard = ref(false);
const loading = ref(true);
watch(
  mode,
  () => {
    confirmHard.value = false;
  },
  { flush: "sync" },
);

async function load() {
  if (!path || !current()) return;
  loading.value = true;
  error.value = null;
  try {
    const result = await getBackend().resetPreview({ path, target });
    if (current()) preview.value = result;
  } catch (reason) {
    showError(reason);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function ok() {
  if (loading.value || !preview.value || busy.value || !current()) return;
  if (mode.value === "hard" && !confirmHard.value) {
    confirmHard.value = true;
    return;
  }
  const resolvedTarget = preview.value.target;
  await submit(() => rewrite.reset(resolvedTarget, mode.value));
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    :aria-label="t('rewrite.resetTitle')"
    :aria-busy="loading || busy"
    @keydown.esc.stop.prevent="dismiss"
  >
    <div
      class="max-h-[90vh] w-full max-w-md overflow-auto rounded-lg border bg-popover p-4 shadow-lg"
    >
      <h2 class="text-sm font-semibold">{{ t("rewrite.resetTitle") }}</h2>
      <p class="mt-1 font-mono text-[11px] text-muted-foreground">{{ target.slice(0, 12) }}</p>
      <p v-if="preview" class="mt-2 text-xs text-muted-foreground">
        {{ t("rewrite.resetCount", { count: preview.commitsAffected }) }}
        <span v-if="preview.willDiscardLocal && mode === 'hard'">{{
          t("rewrite.hardWarning")
        }}</span>
      </p>
      <p v-if="loading" class="mt-2 text-xs text-muted-foreground">{{ t("common.loading") }}</p>
      <p v-if="error" role="alert" class="mt-2 text-xs text-destructive">{{ error }}</p>
      <Button
        v-if="error && !preview"
        size="sm"
        variant="outline"
        :disabled="loading"
        @click="load"
        >{{ t("empty.retry") }}</Button
      >
      <fieldset :disabled="loading || !preview || busy" class="mt-3 grid gap-2 text-xs">
        <label class="flex items-start gap-2">
          <input v-model="mode" type="radio" value="soft" class="mt-0.5" />
          <span><strong>Soft</strong> — {{ t("rewrite.softHint") }}</span>
        </label>
        <label class="flex items-start gap-2">
          <input v-model="mode" type="radio" value="mixed" class="mt-0.5" />
          <span><strong>Mixed</strong> — {{ t("rewrite.mixedHint") }}</span>
        </label>
        <label class="flex items-start gap-2">
          <input v-model="mode" type="radio" value="hard" class="mt-0.5" />
          <span><strong>Hard</strong> — {{ t("rewrite.hardHint") }}</span>
        </label>
        <label class="flex items-start gap-2">
          <input v-model="mode" type="radio" value="keep" class="mt-0.5" />
          <span><strong>Keep</strong> — {{ t("rewrite.keepHint") }}</span>
        </label>
      </fieldset>
      <p v-if="mode === 'hard' && confirmHard" class="mt-2 text-xs text-destructive">
        {{ t("rewrite.hardConfirm") }}
      </p>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" :disabled="busy" @click="dismiss">{{
          t("common.cancel")
        }}</Button>
        <Button
          size="sm"
          :variant="mode === 'hard' ? 'destructive' : 'default'"
          :disabled="loading || !preview || busy"
          @click="ok"
        >
          {{ mode === "hard" && !confirmHard ? t("rewrite.continue") : t("rewrite.reset") }}
        </Button>
      </div>
    </div>
  </div>
</template>
