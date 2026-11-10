<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import VirtualList from "@/components/common/VirtualList.vue";
import { Button } from "@/components/ui/button";
import { useBranchesStore } from "@/stores/branchesStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useRewriteDialog } from "./useRewriteDialog";

const branches = useBranchesStore();
const rewrite = useRewriteStore();
const workspace = useWorkspaceStore();
const { t } = useI18n();
const { busy, error, current, dismiss, showError, submit } = useRewriteDialog();
const loading = ref(true);
const loaded = ref(false);

const selected = ref<string[]>([]);
const noFf = ref(false);
const ffOnly = ref(false);
const squash = ref(false);
const noCommit = ref(false);
const noVerify = ref(false);
const allowUnrelated = ref(false);
const message = ref("");
const customMessage = ref(false);

const otherBranches = computed(() => branches.refs?.local.filter((b) => !b.isHead) ?? []);
const head = computed(() => workspace.branch?.head ?? "HEAD");

const preview = computed(() => {
  const opts = ["merge"];
  if (noFf.value) opts.push("--no-ff");
  if (ffOnly.value) opts.push("--ff-only");
  if (squash.value) opts.push("--squash");
  if (noCommit.value) opts.push("--no-commit");
  if (noVerify.value) opts.push("--no-verify");
  if (allowUnrelated.value) opts.push("--allow-unrelated-histories");
  if (customMessage.value && message.value) opts.push("-m", JSON.stringify(message.value));
  else opts.push("--no-edit");
  opts.push(...selected.value);
  return `git ${opts.join(" ")}`;
});

onMounted(async () => {
  try {
    await branches.refresh();
    if (!current()) return;
    const locals = otherBranches.value.map((b) => b.name);
    if (locals[0]) selected.value = [locals[0]];
    loaded.value = true;
  } catch (reason) {
    showError(reason);
  } finally {
    loading.value = false;
  }
});
const valid = computed(
  () =>
    loaded.value && selected.value.length > 0 && (!customMessage.value || !!message.value.trim()),
);

function toggleBranch(name: string) {
  if (selected.value.includes(name)) {
    selected.value = selected.value.filter((n) => n !== name);
  } else {
    selected.value = [...selected.value, name];
  }
}

async function ok() {
  if (!valid.value || loading.value) return;
  await submit(() =>
    rewrite.merge({
      branches: [...selected.value],
      noFf: noFf.value,
      ffOnly: ffOnly.value,
      squash: squash.value,
      message: customMessage.value ? message.value : null,
      noCommit: noCommit.value,
      noVerify: noVerify.value,
      allowUnrelated: allowUnrelated.value,
    }),
  );
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    :aria-label="t('merge.mergeTitle')"
    :data-dialog-busy="busy"
    @keydown.esc.stop.prevent="dismiss"
  >
    <div
      class="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-popover p-4 shadow-lg"
    >
      <h2 class="text-sm font-semibold">{{ t("merge.mergeTitle") }}</h2>
      <p class="mt-1 text-xs text-muted-foreground">{{ t("merge.mergeInto", { branch: head }) }}</p>
      <p v-if="error" role="alert" class="mt-2 text-xs text-destructive">{{ error }}</p>
      <p v-if="loading" class="mt-2 text-xs text-muted-foreground">{{ t("common.loading") }}</p>
      <fieldset :disabled="busy || loading || !loaded" class="flex min-h-0 flex-1 flex-col">
        <VirtualList
          class="mt-3 shrink-0 rounded border"
          :style="{ height: `${Math.max(1, Math.min(otherBranches.length || 1, 8)) * 30}px` }"
          :items="otherBranches"
          :item-height="30"
          :get-key="(b) => b.name"
        >
          <template #default="{ item: b }">
            <button
              type="button"
              class="flex h-full w-full min-w-0 items-center gap-2 border-b px-2 text-left text-xs last:border-b-0 hover:bg-accent"
              @click="toggleBranch(b.name)"
            >
              <input type="checkbox" :checked="selected.includes(b.name)" readonly tabindex="-1" />
              <span class="truncate font-mono" :title="b.name">{{ b.name }}</span>
            </button>
          </template>
          <template #footer>
            <div
              v-if="loaded && !otherBranches.length"
              class="p-3 text-xs text-muted-foreground"
            >
              {{ t("merge.noOtherBranches") }}
            </div>
          </template>
        </VirtualList>
        <div class="mt-3 text-[11px] font-medium text-muted-foreground">
          {{ t("merge.options") }}
        </div>
        <div class="mt-1 grid grid-cols-2 gap-1 text-xs">
          <label class="flex items-center gap-2"
            ><input v-model="noFf" type="checkbox" :disabled="ffOnly || squash" />
            {{ t("merge.noFastForward") }}</label
          >
          <label class="flex items-center gap-2"
            ><input v-model="ffOnly" type="checkbox" :disabled="noFf || squash" />
            {{ t("merge.fastForwardOnly") }}</label
          >
          <label class="flex items-center gap-2"
            ><input v-model="squash" type="checkbox" :disabled="ffOnly || noFf" />
            {{ t("merge.squashChanges") }}</label
          >
          <label class="flex items-center gap-2"
            ><input v-model="noCommit" type="checkbox" /> {{ t("merge.noAutoCommit") }}</label
          >
          <label class="flex items-center gap-2"
            ><input v-model="noVerify" type="checkbox" /> {{ t("merge.skipHooks") }}</label
          >
          <label class="flex items-center gap-2"
            ><input v-model="allowUnrelated" type="checkbox" />
            {{ t("merge.allowUnrelated") }}</label
          >
          <label class="col-span-2 flex items-center gap-2"
            ><input v-model="customMessage" type="checkbox" /> {{ t("merge.customMessage") }}</label
          >
        </div>
        <p v-if="noCommit && !noFf && !squash" class="mt-2 text-xs text-muted-foreground">
          {{ t("merge.noCommitHint") }}
        </p>
        <input
          v-if="customMessage"
          v-model="message"
          class="mt-2 h-8 w-full rounded-md border bg-background px-2 text-sm"
          :placeholder="t('merge.commitMessage')"
          :aria-label="t('merge.commitMessage')"
        />
      </fieldset>
      <div class="mt-3 rounded bg-muted px-2 py-1 font-mono text-[11px]">{{ preview }}</div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" :disabled="busy" @click="dismiss">{{
          t("common.cancel")
        }}</Button>
        <Button size="sm" :disabled="!valid || loading || busy" @click="ok">{{
          busy ? t("common.loading") : t("merge.mergeTitle")
        }}</Button>
      </div>
    </div>
  </div>
</template>
