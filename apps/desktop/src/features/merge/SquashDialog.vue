<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useRewriteDialog } from "./useRewriteDialog";

const props = defineProps<{ shas: string[]; initialMessage?: string }>();
const rewrite = useRewriteStore();
const { t } = useI18n();
const { busy, error, dismiss, submit } = useRewriteDialog();
const shas = [...props.shas];
const message = ref(props.initialMessage ?? t("rewrite.squashDefault"));

async function ok() {
  if (!message.value.trim() || shas.length < 2) return;
  await submit(() => rewrite.squash(shas, message.value));
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    :aria-label="t('rewrite.squashTitle')"
    :aria-busy="busy"
    @keydown.esc.stop.prevent="dismiss"
  >
    <div
      class="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg border bg-popover p-4 shadow-lg"
    >
      <h2 class="text-sm font-semibold">{{ t("rewrite.squashTitle") }}</h2>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ t("rewrite.selectedCommits", { count: shas.length }) }}
      </p>
      <p v-if="error" role="alert" class="mt-2 text-xs text-destructive">{{ error }}</p>
      <textarea
        v-model="message"
        :aria-label="t('merge.commitMessage')"
        :disabled="busy"
        class="mt-3 min-h-[100px] w-full rounded-md border bg-background p-2 font-mono text-[12.5px]"
      />
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" :disabled="busy" @click="dismiss">{{
          t("common.cancel")
        }}</Button>
        <Button size="sm" :disabled="shas.length < 2 || !message.trim() || busy" @click="ok">{{
          t("rewrite.squash")
        }}</Button>
      </div>
    </div>
  </div>
</template>
