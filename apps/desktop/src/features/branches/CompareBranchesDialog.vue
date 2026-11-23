<script setup lang="ts">
import { onMounted, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import VirtualList from "@/components/common/VirtualList.vue";
import { Button } from "@/components/ui/button";
import { closeDialog, useDialogStack, useDialogState } from "@/composables/useDialog";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { getBackend } from "@/lib/backend";
import type { CompareRange } from "@/lib/backend";
import { formatErrorMessage } from "@/lib/errors";

const props = defineProps<{ left: string; right: string }>();
const { t } = useI18n();
const titleId = `compare-branches-${useId()}`;
const dialog = useDialogState();
const stack = useDialogStack();
const dialogId = dialog.value?.id;
const source = useRepositoryAction(() => closeDialog(null, dialogId))();
const alive = () => source.current() && stack.value.some(item => item.id === dialogId);
const current = () => alive() && dialog.value?.id === dialogId;
const result = ref<CompareRange | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
let generation = 0;

const left = ref(props.left);
const right = ref(props.right);

async function load() {
  if (!current()) return;
  const request = ++generation;
  const latest = () => request === generation && alive();
  loading.value = true;
  error.value = null;
  // Changing the headings must never leave commits from the opposite range.
  result.value = null;
  try {
    const comparison = await getBackend().compareBranches({
      path: source.path!,
      left: left.value,
      right: right.value,
    });
    if (latest()) result.value = comparison;
  } catch (e) {
    if (latest()) error.value = formatErrorMessage(e);
  } finally {
    if (latest()) loading.value = false;
  }
}

function swap() {
  if (!current()) return;
  const t = left.value;
  left.value = right.value;
  right.value = t;
  void load();
}

onMounted(() => void load());
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div
      class="flex h-[390px] max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border bg-popover p-4 shadow-lg"
      role="dialog" aria-modal="true" :aria-labelledby="titleId" :aria-busy="loading"
    >
      <div class="flex shrink-0 items-center gap-2">
        <h2 :id="titleId" class="min-w-0 truncate text-sm font-semibold" :title="`${left} ↔ ${right}`">{{ left }} ↔ {{ right }}</h2>
        <div class="flex-1" />
        <Button size="xs" variant="outline" :disabled="!current()" @click="swap">{{ t("branchCompare.swap") }}</Button>
        <Button size="xs" variant="ghost" @click="closeDialog(null, dialogId)">{{ t("common.close") }}</Button>
      </div>
      <p v-if="loading" role="status" class="mt-2 text-xs text-muted-foreground">{{ t("operations.compareBranches") }}…</p>
      <div v-else-if="error" class="mt-2 flex min-h-0 items-start gap-2 overflow-auto">
        <p role="alert" class="min-w-0 break-words text-xs text-destructive">{{ error }}</p>
        <Button size="xs" variant="outline" class="shrink-0" @click="load">{{ t("branchCompare.retry") }}</Button>
      </div>
      <div v-else-if="result" class="mt-3 grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-hidden">
        <div class="flex min-h-0 flex-col rounded border p-2">
          <div class="mb-1 text-[11px] font-medium text-muted-foreground">
            {{ t("branchCompare.unique", { in: right, notIn: left }) }}
          </div>
          <div v-if="!result.leftOnly.length" class="text-xs text-muted-foreground">
            {{ t("branchCompare.empty") }}
          </div>
          <VirtualList
            :items="result.leftOnly"
            :item-height="22"
            :get-key="(_c, index) => index"
            class="font-mono text-[11px]"
            ><template #default="{ item: c }"
              ><div class="flex h-full min-w-0 items-center" :title="c">
                <span class="truncate">{{ c }}</span>
              </div></template
            ></VirtualList
          >
        </div>
        <div class="flex min-h-0 flex-col rounded border p-2">
          <div class="mb-1 text-[11px] font-medium text-muted-foreground">
            {{ t("branchCompare.unique", { in: left, notIn: right }) }}
          </div>
          <div v-if="!result.rightOnly.length" class="text-xs text-muted-foreground">
            {{ t("branchCompare.empty") }}
          </div>
          <VirtualList
            :items="result.rightOnly"
            :item-height="22"
            :get-key="(_c, index) => index"
            class="font-mono text-[11px]"
            ><template #default="{ item: c }"
              ><div class="flex h-full min-w-0 items-center" :title="c">
                <span class="truncate">{{ c }}</span>
              </div></template
            ></VirtualList
          >
        </div>
      </div>
    </div>
  </div>
</template>
