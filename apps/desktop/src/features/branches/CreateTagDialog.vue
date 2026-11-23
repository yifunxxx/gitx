<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { closeDialog, useDialogStack, useDialogState } from "@/composables/useDialog";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { getBackend } from "@/lib/backend";
import { useBranchesStore } from "@/stores/branchesStore";
import { toast } from "@/composables/useToast";
import { formatErrorMessage } from "@/lib/errors";

const props = defineProps<{ target: string }>();
const { t } = useI18n();
const titleId = `create-tag-${useId()}`;
const dialog = useDialogState();
const stack = useDialogStack();
const dialogId = dialog.value?.id;
const source = useRepositoryAction(() => closeDialog(false, dialogId))();
const alive = () => source.current() && stack.value.some(item => item.id === dialogId);
const current = () => alive() && dialog.value?.id === dialogId;
const branches = useBranchesStore();
const name = ref("");
const message = ref("");
const force = ref(false);
const pushRemote = ref(false);
const phase = ref<"create" | "push" | null>(null);
const created = ref<{ name: string; remote: string | null } | null>(null);
const error = ref("");
const busy = computed(() => phase.value !== null);
const locked = computed(() => busy.value || !!created.value);

function dismiss(event?: KeyboardEvent) {
  if (event) {
    if (event.isComposing || event.keyCode === 229 || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
  }
  if (current() && !busy.value) closeDialog(!!created.value, dialogId);
}

async function pushCreated() {
  const tag = created.value;
  if (!tag?.remote || !alive()) return;
  phase.value = "push";
  await getBackend().tagPush({ path: source.path!, name: tag.name, remote: tag.remote });
}

async function ok() {
  if (!current() || busy.value || !name.value.trim()) return;
  const tagName = name.value.trim();
  const remote = pushRemote.value ? branches.remotes[0]?.name ?? null : null;
  if (!created.value && pushRemote.value && !remote) {
    error.value = t("tagDialog.noRemote");
    return;
  }
  phase.value = created.value ? "push" : "create";
  error.value = "";
  try {
    if (!created.value) {
      await getBackend().tagCreate({
        path: source.path!, name: tagName, target: props.target,
        message: message.value.trim() || null, force: force.value, pushRemote: null,
      });
      if (!alive()) return;
      // Keep the committed local stage so retrying a push cannot recreate it.
      created.value = { name: tagName, remote };
    }
    await pushCreated();
    if (!alive()) return;
    toast({ title: t(created.value.remote ? "tagDialog.createdAndPushed" : "tagDialog.created", { name: created.value.name }) });
    closeDialog(true, dialogId);
  } catch (e) {
    if (alive()) error.value = formatErrorMessage(e);
  } finally {
    phase.value = null;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg"
      role="dialog" aria-modal="true" :aria-labelledby="titleId" :aria-busy="busy" @keydown.esc="dismiss">
      <h2 :id="titleId" class="text-sm font-semibold">{{ t("tagDialog.title") }}</h2>
      <p class="mt-1 text-[11px] text-muted-foreground">{{ t("tagDialog.target", { target: props.target }) }}</p>
      <input v-model="name" :disabled="locked" class="mt-3 h-8 w-full rounded-md border bg-background px-2 text-sm" :placeholder="t('tagDialog.name')" :aria-label="t('tagDialog.name')" autofocus />
      <textarea v-model="message" :disabled="locked" class="mt-2 h-20 w-full rounded-md border bg-background px-2 py-1 text-sm" :placeholder="t('tagDialog.message')" :aria-label="t('tagDialog.message')" />
      <label class="mt-2 flex items-center gap-2 text-xs"><input v-model="force" type="checkbox" :disabled="locked" /> {{ t("tagDialog.force") }}</label>
      <label class="mt-1 flex items-center gap-2 text-xs"><input v-model="pushRemote" type="checkbox" :disabled="locked || !branches.remotes.length" /> {{ t("tagDialog.pushAfter") }}</label>
      <p v-if="created && error" class="mt-2 text-xs text-muted-foreground">{{ t("tagDialog.localCreated", { name: created.name, remote: created.remote }) }}</p>
      <p v-if="error" role="alert" class="mt-2 break-words text-xs text-destructive">{{ error }}</p>
      <p v-if="busy" role="status" class="mt-2 text-xs text-muted-foreground">{{ t(phase === "create" ? "operations.tagCreate" : "operations.tagPush") }}…</p>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" :disabled="busy" @click="dismiss()">{{ t(created ? "common.close" : "common.cancel") }}</Button>
        <Button size="sm" :disabled="busy || !name.trim() || !current()" @click="ok">{{ t(created ? "tagDialog.retryPush" : "tagDialog.create") }}</Button>
      </div>
    </div>
  </div>
</template>
