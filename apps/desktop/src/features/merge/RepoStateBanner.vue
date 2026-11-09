<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { formatErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { openDialog } from "@/composables/useDialog";
import ConflictsDialog from "./ConflictsDialog.vue";

const rewrite = useRewriteStore();
const { t } = useI18n();
const error = ref<string | null>(null);
let repositoryGeneration = 0;
async function run(action: () => Promise<unknown>) {
  const generation = repositoryGeneration;
  error.value = null;
  try {
    await action();
  } catch (e) {
    if (generation === repositoryGeneration) error.value = formatErrorMessage(e);
  }
}
const workspace = useWorkspaceStore();

const visible = computed(() => !!rewrite.opState && rewrite.opState.kind !== "normal");

onMounted(() => {
  if (workspace.isRepo) void rewrite.refreshOpState();
});

watch(
  () => workspace.repoPath,
  () => {
    ++repositoryGeneration;
    error.value = null;
    if (workspace.isRepo) void rewrite.refreshOpState();
  },
  { flush: "sync" },
);

function resolve() {
  void openDialog(ConflictsDialog, {});
}
</script>

<template>
  <div
    v-if="visible && rewrite.opState"
    class="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs"
  >
    <span class="font-medium">{{
      t(`merge.operations.${rewrite.opState.kind}`, {
        ours: rewrite.opState.yoursLabel,
        theirs:
          rewrite.opState.kind === "rebase"
            ? rewrite.opState.headBranch || "HEAD"
            : rewrite.opState.theirsLabel,
      })
    }}</span>
    <span v-if="rewrite.opState.step != null && rewrite.opState.total != null">
      ({{ rewrite.opState.step }}/{{ rewrite.opState.total }})
    </span>
    <span v-if="rewrite.opState.phase === 'stoppedForEdit'">
      {{ t("merge.stoppedForEdit") }}
    </span>
    <span v-if="rewrite.opState.conflictCount" class="text-muted-foreground">
      {{ t("merge.remaining", { count: rewrite.opState.conflictCount }) }}
    </span>
    <p v-if="error" role="alert" class="w-full text-destructive">{{ error }}</p>
    <div class="ml-auto flex flex-wrap gap-1">
      <Button v-if="rewrite.opState.conflictCount > 0" size="xs" variant="outline" @click="resolve">
        {{ t("merge.resolve") }}
      </Button>
      <Button
        v-if="
          rewrite.opState.phase === 'readyToContinue' ||
          rewrite.opState.phase === 'stoppedForEdit' ||
          (rewrite.opState.conflictCount === 0 && rewrite.opState.kind !== 'normal')
        "
        size="xs"
        :disabled="rewrite.busy"
        @click="run(() => rewrite.continueOp())"
      >
        {{ rewrite.opState.kind === "merge" ? t("merge.commitMerge") : t("merge.continue") }}
      </Button>
      <Button
        v-if="rewrite.opState.kind === 'rebase' || rewrite.opState.kind === 'cherryPick'"
        size="xs"
        variant="outline"
        :disabled="rewrite.busy"
        @click="run(() => rewrite.skip())"
      >
        {{ t("merge.skip") }}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        :disabled="rewrite.busy"
        @click="run(() => rewrite.abort())"
      >
        {{ t("merge.abort") }}
      </Button>
    </div>
  </div>
</template>
