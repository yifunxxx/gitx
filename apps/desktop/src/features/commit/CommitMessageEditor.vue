<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useCommitStore } from "@/stores/commitStore";
import { useLogStore } from "@/stores/logStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/composables/useToast";
import { formatErrorMessage } from "@/lib/errors";

const { t } = useI18n();
const commit = useCommitStore();
const log = useLogStore();
const rewrite = useRewriteStore();
const amendTarget = ref("HEAD");

const amendOptions = computed(() => [
  { value: "HEAD", label: "HEAD" },
  ...log.commits.slice(0, 12).map((c) => ({
    value: c.sha,
    label: `${c.sha.slice(0, 7)} ${c.subject.slice(0, 32)}`,
  })),
]);

async function onAmendChange(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  await commit.setAmend(checked);
  if (!checked) amendTarget.value = "HEAD";
}

async function onAmendTargetChange(value: string) {
  amendTarget.value = value;
  if (value === "HEAD" || !value) {
    await commit.setAmend(true);
    return;
  }
  // Early commit amend via fixup (#61 / #108).
  await commit.setAmend(false);
  try {
    await rewrite.fixupInto(value, false);
    toast({ title: t("commit.fixupOk") });
    amendTarget.value = "HEAD";
  } catch (e: unknown) {
    toast({
      title: t("commit.fixupFail"),
      description: formatErrorMessage(e),
    });
  }
}

const recentLocal = () => amendOptions.value;
</script>

<template>
  <div class="flex shrink-0 flex-col border-t bg-sidebar">
    <div class="flex flex-wrap items-center gap-3 border-b px-2 py-1.5 text-xs">
      <label class="flex items-center gap-1.5">
        <input
          type="checkbox"
          class="accent-foreground"
          :checked="commit.amend"
          @change="onAmendChange"
        />
        {{ t("commit.amend") }}
      </label>
      <label class="flex items-center gap-1.5 text-muted-foreground">
        {{ t("commit.amendCommit") }}
        <Select :model-value="amendTarget" @update:model-value="(v) => onAmendTargetChange(String(v ?? 'HEAD'))">
          <SelectTrigger class="h-6 max-w-[12rem] text-[11px]">
            <SelectValue :placeholder="'HEAD'" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="opt in recentLocal()" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label class="flex items-center gap-1.5 text-muted-foreground">
        <input v-model="commit.runHooks" type="checkbox" class="accent-foreground" />
        {{ t("commit.runHooks") }}
      </label>
    </div>
    <textarea
      v-model="commit.message"
      class="min-h-[88px] resize-none bg-transparent px-2 py-1.5 font-mono text-[12.5px] outline-none placeholder:text-muted-foreground"
      :placeholder="t('commit.messagePlaceholder')"
      spellcheck="false"
    />
    <div class="flex items-center justify-end gap-2 border-t px-2 py-1.5">
      <Button
        size="sm"
        :disabled="commit.committing || !commit.message.trim()"
        @click="commit.commit()"
      >
        {{ commit.amend ? t("commit.amendCommitAction") : t("actions.commit") }}
      </Button>
    </div>
  </div>
</template>
