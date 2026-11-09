<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleAuthFailure } from "@/composables/useCredentials";
import { Button } from "@/components/ui/button";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { getBackend } from "@/lib/backend";
import { isTauri } from "@/lib/utils";
import { toast } from "@/composables/useToast";
import { promptDialog } from "@/composables/useConfirm";
import { formatErrorMessage } from "@/lib/errors";

const { t } = useI18n();
const dialogId = useDialogState().value?.id;
const busy = ref(false);
const cancelling = ref(false);
const error = ref<string | null>(null);
let generation = 0;
let alive = true;
let home = "";
let suggested = "";
const url = ref("");
const dir = ref("");
const shallow = ref(false);
const depth = ref(1);
const openAfter = ref(true);
const urlOk = ref<boolean | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
let cancelTimer: ReturnType<typeof setTimeout> | null = null;
let activeJobId: string | null = null;
let cancelRetryDelay = 50;

function suggestDirectory() {
  if (!home || (dir.value && dir.value !== suggested)) return;
  const name = url.value
    .trim()
    .replace(/\/$/, "")
    .replace(/\.git$/, "")
    .split(/[/:]/)
    .pop();
  if (name) dir.value = suggested = `${home.replace(/[/\\]$/, "")}/${name}`;
}
onMounted(async () => {
  if (isTauri()) {
    try {
      const { homeDir } = await import("@tauri-apps/api/path");
      home = await homeDir();
      if (alive) suggestDirectory();
    } catch {
      // The destination remains editable if the home directory is unavailable.
    }
  }
});
onUnmounted(() => {
  alive = false;
  ++generation;
  if (timer) clearTimeout(timer);
  if (busy.value && activeJobId && !cancelling.value) {
    cancelling.value = true;
    void requestCancellation(activeJobId);
  }
});

watch(url, (v) => {
  const gen = ++generation;
  urlOk.value = null;
  if (timer) clearTimeout(timer);
  if (!v.trim()) return;
  timer = setTimeout(async () => {
    try {
      const found = await getBackend().cloneCheckUrl({ url: v.trim() });
      if (alive && gen === generation) urlOk.value = found;
    } catch {
      if (alive && gen === generation) urlOk.value = false;
    }
  }, 600);
  suggestDirectory();
});

async function browse() {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    if (alive && !busy.value && typeof selected === "string") dir.value = selected;
  } else {
    const p = await promptDialog({
      title: t("clone.directory"),
      defaultValue: dir.value,
      allowEmpty: false,
    });
    if (alive && !busy.value && p) dir.value = p;
  }
}

async function cancel() {
  if (!busy.value) {
    closeDialog(null, dialogId);
    return;
  }
  if (cancelling.value) return;
  error.value = null;
  cancelRetryDelay = 50;
  cancelling.value = true;
  if (activeJobId) await requestCancellation(activeJobId);
}

function onEscape(event: KeyboardEvent) {
  if (event.isComposing || event.defaultPrevented) return;
  event.preventDefault();
  void cancel();
}

async function requestCancellation(jobId: string) {
  if (activeJobId !== jobId || !cancelling.value) return;
  const retry = () => {
    if (activeJobId !== jobId || !cancelling.value) return;
    cancelTimer = setTimeout(() => void requestCancellation(jobId), cancelRetryDelay);
    cancelRetryDelay = Math.min(cancelRetryDelay * 2, 1000);
  };
  try {
    if (!(await getBackend().jobCancel(jobId))) retry();
  } catch (err) {
    if (activeJobId !== jobId) return;
    // The cancel IPC can reach Rust before clone_run registers its job. Keep
    // the user's cancellation intent until registration or clone completion.
    if ((err as { code?: string })?.code === "notFound") retry();
    else {
      if (alive) error.value = formatErrorMessage(err);
      cancelling.value = false;
    }
  }
}

async function ok() {
  if (
    busy.value ||
    !url.value.trim() ||
    !dir.value.trim() ||
    (shallow.value && (!Number.isInteger(depth.value) || depth.value < 1))
  )
    return;
  busy.value = true;
  error.value = null;
  cancelling.value = false;
  const request = {
    url: url.value.trim(),
    dir: dir.value.trim(),
    depth: shallow.value ? depth.value : null,
    branch: null,
    openAfter: openAfter.value,
  };
  const run = async () => {
    const jobId = crypto.randomUUID();
    cancelRetryDelay = 50;
    activeJobId = jobId;
    try {
      return await getBackend().cloneRun({ ...request, jobId });
    } finally {
      if (activeJobId === jobId) activeJobId = null;
      if (cancelTimer) clearTimeout(cancelTimer);
      cancelTimer = null;
    }
  };
  try {
    let result;
    try {
      result = await run();
    } catch (err) {
      if (cancelling.value || !alive) {
        if (alive) closeDialog(null, dialogId);
        return;
      }
      const retry = await handleAuthFailure(err, { url: request.url });
      if (cancelling.value || !alive) {
        if (alive) closeDialog(null, dialogId);
        return;
      }
      if (!retry) throw err;
      result = await run();
    }
    if (!alive) return;
    if (cancelling.value) {
      closeDialog(null, dialogId);
      return;
    }
    toast({ title: t("clone.done"), description: result.path });
    closeDialog(request.openAfter ? result.path : null, dialogId);
  } catch (err) {
    if (!alive) return;
    if (cancelling.value) closeDialog(null, dialogId);
    else error.value = formatErrorMessage(err);
  } finally {
    busy.value = false;
    cancelling.value = false;
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4"
    @keydown.esc.stop="onEscape"
  >
    <form
      class="w-full max-w-lg rounded-lg border bg-popover p-4 shadow-lg"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clone-title"
      @submit.prevent="ok"
    >
      <h2 id="clone-title" class="text-sm font-semibold">{{ t("clone.title") }}</h2>
      <label for="clone-url" class="mt-3 block text-[11px] text-muted-foreground">{{
        t("clone.url")
      }}</label>
      <input
        id="clone-url"
        v-model="url"
        :disabled="busy"
        class="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm font-mono"
        autofocus
      />
      <p
        class="mt-1 min-h-4 text-[11px]"
        :class="urlOk === false ? 'text-destructive' : 'text-muted-foreground'"
      >
        <template v-if="urlOk === true">{{ t("clone.found") }}</template>
        <template v-else-if="urlOk === false">{{ t("clone.checkFailed") }}</template>
      </p>
      <label for="clone-directory" class="mt-3 block text-[11px] text-muted-foreground">{{
        t("clone.directory")
      }}</label>
      <div class="mt-1 flex gap-2">
        <input
          id="clone-directory"
          v-model="dir"
          :disabled="busy"
          class="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm font-mono"
        />
        <Button type="button" size="sm" variant="outline" :disabled="busy" @click="browse">{{
          t("clone.browse")
        }}</Button>
      </div>
      <label class="mt-3 flex items-center gap-2 text-xs">
        <input v-model="shallow" type="checkbox" :disabled="busy" /> {{ t("clone.shallow") }}
        <input
          v-model.number="depth"
          type="number"
          min="1"
          class="h-6 w-16 rounded border bg-background px-1"
          :disabled="!shallow || busy"
          :aria-label="t('clone.depth')"
        />
      </label>
      <label class="mt-1 flex items-center gap-2 text-xs">
        <input v-model="openAfter" type="checkbox" :disabled="busy" /> {{ t("clone.openAfter") }}
      </label>
      <p
        v-if="error"
        role="alert"
        class="mt-3 max-h-28 overflow-auto break-words text-xs text-destructive"
      >
        {{ error }}
      </p>
      <p v-if="busy" role="status" class="mt-3 text-xs text-muted-foreground">
        {{ t(cancelling ? "clone.cancelling" : "clone.running") }}
      </p>
      <div class="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" :disabled="cancelling" @click="cancel">{{
          t("clone.cancel")
        }}</Button>
        <Button type="submit" size="sm" :disabled="busy || !url.trim() || !dir.trim()">{{
          t("clone.start")
        }}</Button>
      </div>
    </form>
  </div>
</template>
