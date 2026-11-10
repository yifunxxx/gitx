<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useCommitStore } from "@/stores/commitStore";
import { useLogStore } from "@/stores/logStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/composables/useToast";
import { formatErrorMessage } from "@/lib/errors";
import { useRepositoryAction } from "@/composables/useRepositoryAction";

const { t } = useI18n();
const commit = useCommitStore();
const log = useLogStore();
const rewrite = useRewriteStore();
const amendTarget = ref("HEAD");
const choosingTarget = ref(false);
const captureOperation = useRepositoryAction(() => {
  amendTarget.value = "HEAD";
  choosingTarget.value = false;
});
const modeBusy = computed(() => commit.committing || rewrite.busy || choosingTarget.value);
const submitDisabled = computed(
  () => modeBusy.value || commit.amendLoading || !!commit.amendError || !commit.message.trim(),
);

const amendOptions = computed(() => [
  { value: "HEAD", label: "HEAD" },
  ...log.commits.slice(0, 12).map((c) => ({
    value: c.sha,
    label: `${c.sha.slice(0, 7)} ${c.subject.slice(0, 32)}`,
  })),
]);

async function onAmendChange(e: Event) {
  if (modeBusy.value) return;
  const checked = (e.target as HTMLInputElement).checked;
  if (!checked) amendTarget.value = "HEAD";
  await commit.setAmend(checked);
}

async function onAmendTargetChange(value: string) {
  if (modeBusy.value || commit.amendLoading || commit.amendError) return;
  const source = captureOperation();
  if (!source.current()) return;
  amendTarget.value = value;
  if (value === "HEAD" || !value) {
    await commit.setAmend(true);
    return;
  }
  choosingTarget.value = true;
  try {
    await commit.setAmend(false);
    if (!source.current()) return;
    // Early commit amend via fixup (#61 / #108).
    const result = await rewrite.fixupInto(value, false);
    if (source.current()) {
      if (result?.outcome === "success") toast({ title: t("commit.fixupOk") });
      amendTarget.value = "HEAD";
    }
  } catch (e: unknown) {
    if (source.current())
      toast({
        title: t("commit.fixupFail"),
        description: formatErrorMessage(e),
      });
  } finally {
    if (source.current()) choosingTarget.value = false;
  }
}

async function submit() {
  if (submitDisabled.value) return;
  try {
    await commit.commit();
  } catch {
    // The store reports current-session failures and preserves the draft.
  }
}
</script>

<template>
  <div class="flex shrink-0 flex-col border-t bg-sidebar">
    <div class="flex flex-wrap items-center gap-3 border-b px-2 py-1.5 text-xs">
      <Tip :text="t('commit.amendTip')">
        <label class="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            class="accent-foreground"
            :checked="commit.amend"
            :disabled="modeBusy"
            @change="onAmendChange"
          />
          {{ t("commit.amend") }}
        </label>
      </Tip>
      <!-- Only when Amend is on: pick HEAD (default) or an earlier commit to fixup into. -->
      <Tip v-if="commit.amend" :text="t('commit.amendTargetTip')">
        <label class="flex items-center gap-1.5 text-muted-foreground">
          <span class="shrink-0 whitespace-nowrap">{{ t("commit.amendTarget") }}</span>
          <Select
            :model-value="amendTarget"
            :disabled="modeBusy || commit.amendLoading || !!commit.amendError"
            @update:model-value="(v) => onAmendTargetChange(String(v ?? 'HEAD'))"
          >
            <SelectTrigger class="h-6 w-auto min-w-[4.5rem] max-w-[12rem] text-[11px]">
              <SelectValue :placeholder="'HEAD'" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt in amendOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
      </Tip>
      <label class="flex items-center gap-1.5 text-muted-foreground">
        <input
          v-model="commit.runHooks"
          type="checkbox"
          class="accent-foreground"
          :disabled="modeBusy"
        />
        {{ t("commit.runHooks") }}
      </label>
    </div>
    <div v-if="commit.amendLoading" role="status" class="px-2 py-1.5 text-xs text-muted-foreground">
      {{ t("commit.amendLoading") }}
    </div>
    <div
      v-else-if="commit.amendError"
      role="alert"
      class="flex items-center gap-2 px-2 py-1.5 text-xs"
    >
      <span class="min-w-0 break-words text-destructive">
        {{ t("commit.amendLoadFailed") }} {{ commit.amendError }}
      </span>
      <Button size="sm" variant="outline" :disabled="modeBusy" @click="commit.setAmend(true)">
        {{ t("commit.amendRetry") }}
      </Button>
    </div>
    <textarea
      v-model="commit.message"
      class="min-h-[88px] resize-none bg-transparent px-2 py-1.5 font-mono text-[12.5px] outline-none placeholder:text-muted-foreground"
      :placeholder="t('commit.messagePlaceholder')"
      :aria-label="t('commit.messagePlaceholder')"
      spellcheck="false"
    />
    <div class="flex items-center justify-end gap-2 border-t px-2 py-1.5">
      <Button size="sm" :disabled="submitDisabled" @click="submit">
        {{ commit.amend ? t("commit.amendCommitAction") : t("actions.commit") }}
      </Button>
    </div>
  </div>
</template>
