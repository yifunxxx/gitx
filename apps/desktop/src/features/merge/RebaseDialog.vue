<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { closeDialog, openDialog, useDialogState } from "@/composables/useDialog";
import { useBranchesStore } from "@/stores/branchesStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useRewriteDialog } from "./useRewriteDialog";
import InteractiveRebaseEditor from "@/features/merge/InteractiveRebaseEditor.vue";

const branches = useBranchesStore();
const rewrite = useRewriteStore();
const workspace = useWorkspaceStore();
const { t } = useI18n();
const dialog = useDialogState();
const dialogId = dialog.value?.id;
const { busy, error, current, dismiss, showError, submit } = useRewriteDialog();

const upstream = ref("");
const onto = ref("");
const useOnto = ref(false);
const switchBranch = ref("");
const rebaseMerges = ref(false);
const keepEmpty = ref(false);
const root = ref(false);
const updateRefs = ref(false);
const autosquash = ref(false);
const interactive = ref(false);
const loading = ref(true);
const loaded = ref(false);
const valid = computed(
  () => (root.value || upstream.value.trim()) && (!useOnto.value || onto.value.trim()),
);
const head = computed(() => workspace.branch?.head ?? "HEAD");

const preview = computed(() => {
  const opts = ["rebase"];
  if (interactive.value) opts.push("-i");
  if (rebaseMerges.value) opts.push("--rebase-merges");
  if (!interactive.value && keepEmpty.value) opts.push("--keep-empty");
  if (root.value) opts.push("--root");
  if (!interactive.value && updateRefs.value) opts.push("--update-refs");
  if (autosquash.value) opts.push("--autosquash");
  if (useOnto.value) opts.push("--onto", onto.value || "<onto>");
  if (!root.value) opts.push(upstream.value || "<upstream>");
  if (!interactive.value && switchBranch.value) opts.push(switchBranch.value);
  return "git " + opts.join(" ");
});

async function load() {
  if (!current() || busy.value) return;
  loading.value = true;
  error.value = null;
  try {
    await branches.refresh();
    if (!current()) return;
    const locals = branches.refs?.local.filter((b) => !b.isHead).map((b) => b.name) ?? [];
    const remotes = branches.refs?.remote.map((b) => b.name) ?? [];
    if (!upstream.value) upstream.value = remotes[0] ?? locals[0] ?? "main";
    loaded.value = true;
  } catch (e) {
    showError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function ok() {
  if (!loaded.value || !valid.value || loading.value || busy.value || !current()) return;
  if (interactive.value) {
    closeDialog(false, dialogId);
    void openDialog(InteractiveRebaseEditor, {
      upstream: root.value ? undefined : upstream.value.trim(),
      root: root.value,
      onto: useOnto.value ? onto.value.trim() : null,
      rebaseMerges: rebaseMerges.value,
      autosquash: autosquash.value,
    });
    return;
  }
  await submit(() =>
    rewrite.rebase({
      upstream: upstream.value.trim(),
      onto: useOnto.value ? onto.value.trim() : null,
      branch: switchBranch.value.trim() || null,
      rebaseMerges: rebaseMerges.value,
      keepEmpty: keepEmpty.value,
      root: root.value,
      updateRefs: updateRefs.value,
      autosquash: autosquash.value,
      interactive: false,
    }),
  );
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    :aria-label="t('merge.rebaseTitle')"
    :data-dialog-busy="busy"
    @keydown.esc.stop.prevent="dismiss"
  >
    <div
      class="max-h-full w-full max-w-lg overflow-auto rounded-lg border bg-popover p-4 shadow-lg"
    >
      <h2 class="text-sm font-semibold">{{ t("merge.rebaseTitle") }}</h2>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ t("merge.currentBranch", { branch: head }) }}
      </p>
      <p v-if="error" role="alert" class="mt-2 text-xs text-destructive">{{ error }}</p>
      <Button
        v-if="error && !loaded"
        size="sm"
        variant="outline"
        :disabled="loading"
        @click="load"
        >{{ t("empty.retry") }}</Button
      >
      <fieldset :disabled="busy || loading || !loaded" class="mt-3 grid gap-2">
        <label class="text-[11px] text-muted-foreground"
          >{{ t("merge.upstream") }}
          <input
            v-model="upstream"
            class="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm"
            :disabled="root || loading"
          />
        </label>
        <div class="flex items-center gap-2 text-xs">
          <label class="flex items-center gap-2"
            ><input v-model="useOnto" type="checkbox" /> --onto</label
          >
          <input
            v-model="onto"
            :aria-label="t('merge.ontoTarget')"
            class="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
            :disabled="!useOnto"
            :placeholder="t('merge.ontoTarget')"
          />
        </div>
        <label class="text-[11px] text-muted-foreground"
          >{{ t("merge.switchBranch") }}
          <input
            v-model="switchBranch"
            class="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm"
            :disabled="interactive"
          />
        </label>
        <div class="mt-1 text-[11px] font-medium text-muted-foreground">
          {{ t("merge.options") }}
        </div>
        <div class="grid grid-cols-2 gap-1 text-xs">
          <label class="flex items-center gap-2"
            ><input v-model="interactive" type="checkbox" /> --interactive</label
          >
          <label class="flex items-center gap-2"
            ><input v-model="rebaseMerges" type="checkbox" /> --rebase-merges</label
          >
          <label class="flex items-center gap-2"
            ><input v-model="keepEmpty" type="checkbox" :disabled="interactive" />
            --keep-empty</label
          >
          <label class="flex items-center gap-2"
            ><input v-model="root" type="checkbox" /> --root</label
          >
          <label class="flex items-center gap-2"
            ><input v-model="updateRefs" type="checkbox" :disabled="interactive" />
            --update-refs</label
          >
          <label class="flex items-center gap-2"
            ><input v-model="autosquash" type="checkbox" /> --autosquash</label
          >
        </div>
      </fieldset>
      <p v-if="interactive" class="mt-2 text-[11px] text-muted-foreground">
        {{ t("merge.interactiveOptionsHint") }}
      </p>
      <div class="mt-3 break-words rounded bg-muted px-2 py-1 font-mono text-[11px]">
        {{ preview }}
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" :disabled="busy" @click="dismiss">{{
          t("common.cancel")
        }}</Button>
        <Button size="sm" :disabled="!loaded || !valid || loading || busy" @click="ok">{{
          interactive ? t("merge.editPlan") : t("merge.rebaseTitle")
        }}</Button>
      </div>
    </div>
  </div>
</template>
