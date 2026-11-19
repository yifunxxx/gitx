<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { Button } from "@/components/ui/button";
import { closeDialog, openDialog, useDialogStack, useDialogState } from "@/composables/useDialog";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import { getBackend } from "@/lib/backend";
import type { RemoteInfo } from "@/lib/backend";
import { useBranchesStore } from "@/stores/branchesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { toast } from "@/composables/useToast";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import { formatErrorMessage } from "@/lib/errors";

const remotes = ref<RemoteInfo[]>([]);
const name = ref("");
const url = ref("");
const fetchAfter = ref(true);
const editing = ref<(RemoteInfo & { originalName: string }) | null>(null);
const phase = ref<"load" | "preview" | "confirm" | "write" | null>(null);
const ready = ref(false);
const error = ref<string | null>(null);
const refreshFailed = ref(false);
const branches = useBranchesStore();
const dialog = useDialogState();
const stack = useDialogStack();
const dialogId = dialog.value?.id;
const titleId = `remotes-${useId()}`;
let confirmationId: number | undefined;
let disposed = false;
function closeConfirmation() {
  if (confirmationId !== undefined) closeDialog(false, confirmationId);
  confirmationId = undefined;
}
const source = useRepositoryAction(() => {
  closeConfirmation();
  closeDialog(false, dialogId);
})();
const alive = () =>
  !disposed && source.current() && stack.value.some((item) => item.id === dialogId);
const current = () => alive() && dialog.value?.id === dialogId;
const busy = computed(() => phase.value !== null);
const canMutate = computed(() => current() && ready.value && !busy.value);
const canAdd = computed(
  () => canMutate.value && !editing.value && !!name.value.trim() && !!url.value.trim(),
);
const canSave = computed(
  () => canMutate.value && !!editing.value?.name.trim() && !!editing.value?.fetchUrl.trim(),
);

function dismiss(event?: KeyboardEvent) {
  if (event?.isComposing) return;
  event?.preventDefault();
  event?.stopPropagation();
  if (current() && phase.value !== "write") closeDialog(false, dialogId);
}
onBeforeUnmount(() => {
  disposed = true;
  closeConfirmation();
});

async function readRemotes() {
  const result = await getBackend().remoteList({ path: source.path! });
  if (!alive()) return;
  remotes.value = result.map((remote) => ({ ...remote }));
  ready.value = true;
}

async function refreshViews() {
  const results = await Promise.allSettled([readRemotes(), branches.refresh()]);
  if (!alive()) return;
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  if (branches.error) throw new Error(branches.error);
}

async function load() {
  if (!current() || busy.value) return;
  const afterWrite = refreshFailed.value;
  phase.value = "load";
  error.value = null;
  try {
    if (afterWrite) await refreshViews();
    else await readRemotes();
    if (alive()) refreshFailed.value = false;
  } catch (reason) {
    if (alive()) {
      error.value = afterWrite
        ? `Remote changes were applied, but refresh failed: ${formatErrorMessage(reason)}`
        : `Could not load remotes: ${formatErrorMessage(reason)}`;
    }
  } finally {
    phase.value = null;
  }
}

async function write(action: () => Promise<unknown>, success: string, finish?: () => void) {
  if (!canMutate.value) return;
  phase.value = "write";
  error.value = null;
  refreshFailed.value = false;
  let written = false;
  try {
    await action();
    written = true;
    if (!alive()) return;
    finish?.();
    toast({ title: success });
    // The write is committed already. A failed read must not invite repeating it.
    ready.value = false;
    await refreshViews();
  } catch (reason) {
    if (!alive()) return;
    refreshFailed.value = written;
    error.value = written
      ? `${success}, but refresh failed: ${formatErrorMessage(reason)}`
      : formatErrorMessage(reason);
  } finally {
    phase.value = null;
  }
}

async function add() {
  if (!canAdd.value) return;
  const args = {
    path: source.path!,
    name: name.value.trim(),
    url: url.value.trim(),
    fetchAfter: fetchAfter.value,
  };
  await write(
    () => getBackend().remoteAdd(args),
    `Remote ${args.name} added`,
    () => {
      name.value = "";
      url.value = "";
    },
  );
}

function startEdit(remote: RemoteInfo) {
  if (!canMutate.value || editing.value) return;
  editing.value = { ...remote, originalName: remote.name };
  error.value = null;
}

async function saveEdit() {
  if (!canSave.value || !editing.value) return;
  const draft = editing.value;
  const args = {
    path: source.path!,
    name: draft.originalName,
    newName: draft.name.trim(),
    url: draft.fetchUrl.trim(),
    pushUrl: draft.pushUrl,
  };
  await write(
    () => getBackend().remoteEdit(args),
    `Remote ${args.newName} saved`,
    () => {
      editing.value = null;
    },
  );
}

async function remove(remote: RemoteInfo) {
  if (!canMutate.value || editing.value) return;
  const args = { path: source.path!, name: remote.name };
  phase.value = "preview";
  error.value = null;
  try {
    const preview = await getBackend().remoteRemovePreview(args);
    if (!current()) return;
    phase.value = "confirm";
    const answer = openDialog<boolean>(ConfirmDialog, {
      title: `Remove remote '${args.name}'?`,
      message: `This will remove ${preview.trackingCount} remote-tracking branch(es).`,
      confirmLabel: "Remove",
      destructive: true,
    });
    confirmationId = dialog.value?.id;
    const ok = await answer;
    confirmationId = undefined;
    if (!ok || !current()) return;
    phase.value = null;
    await write(() => getBackend().remoteRemove(args), `Removed ${args.name}`);
  } catch (reason) {
    if (alive()) error.value = formatErrorMessage(reason);
  } finally {
    phase.value = null;
  }
}

fetchAfter.value = useSettingsStore().settings?.git?.fetchOnAddRemote ?? true;
onMounted(load);
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4"
    @keydown.esc="dismiss"
  >
    <div
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-busy="busy"
      class="flex max-h-[80vh] w-full max-w-xl flex-col rounded-lg border bg-popover p-4 shadow-lg"
    >
      <div class="flex items-center">
        <h2 :id="titleId" class="text-sm font-semibold">Manage Remotes</h2>
        <div class="flex-1" />
        <Button size="xs" variant="ghost" :disabled="phase === 'write'" @click="dismiss()"
          >Close</Button
        >
      </div>

      <p v-if="busy" role="status" class="mt-2 text-xs text-muted-foreground">
        {{
          phase === "load"
            ? "Loading remotes…"
            : phase === "write"
              ? "Saving remote…"
              : "Checking remote removal…"
        }}
      </p>
      <div v-if="error" role="alert" class="mt-2 text-xs text-destructive">
        {{ error }}
        <Button
          v-if="!ready || refreshFailed"
          size="xs"
          variant="outline"
          :disabled="busy"
          @click="load"
          >Retry</Button
        >
      </div>
      <p v-if="ready && !remotes.length" class="mt-3 text-xs text-muted-foreground">
        No remotes configured.
      </p>

      <div class="mt-3 min-h-0 flex-1 overflow-auto">
        <table class="w-full text-left text-xs">
          <thead class="text-muted-foreground">
            <tr>
              <th class="py-1 font-medium">Name</th>
              <th class="py-1 font-medium">URL</th>
              <th class="py-1" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in remotes" :key="r.name" class="border-t">
              <td class="py-1.5 pr-2 align-top">
                <input
                  v-if="editing?.originalName === r.name"
                  v-model="editing.name"
                  aria-label="Remote name"
                  :disabled="busy"
                  class="h-7 w-24 rounded border bg-background px-1"
                />
                <span v-else>{{ r.name }}</span>
              </td>
              <td class="py-1.5 pr-2 align-top">
                <input
                  v-if="editing?.originalName === r.name"
                  v-model="editing.fetchUrl"
                  aria-label="Remote URL"
                  :disabled="busy"
                  class="h-7 w-full rounded border bg-background px-1 font-mono"
                />
                <span v-else class="font-mono break-all">{{ r.fetchUrl }}</span>
              </td>
              <td class="py-1.5 whitespace-nowrap text-right">
                <template v-if="editing?.originalName === r.name">
                  <Button size="xs" :disabled="!canSave" @click="saveEdit">Save</Button>
                  <Button size="xs" variant="ghost" :disabled="busy" @click="editing = null"
                    >Cancel</Button
                  >
                </template>
                <Button
                  v-else
                  size="xs"
                  variant="ghost"
                  :disabled="!canMutate || !!editing"
                  @click="startEdit(r)"
                  >Edit</Button
                >
                <Button
                  size="xs"
                  variant="ghost"
                  class="text-destructive"
                  :aria-label="`Remove remote ${r.name}`"
                  :disabled="!canMutate || !!editing"
                  @click="remove(r)"
                  >−</Button
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-3 border-t pt-3">
        <div class="text-[11px] font-medium text-muted-foreground">Add Remote</div>
        <div class="mt-2 flex gap-2">
          <input
            v-model="name"
            :disabled="busy || !!editing || !ready"
            aria-label="New remote name"
            class="h-8 w-28 rounded-md border bg-background px-2 text-sm"
            placeholder="origin"
          />
          <input
            v-model="url"
            :disabled="busy || !!editing || !ready"
            aria-label="New remote URL"
            class="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm font-mono"
            placeholder="https://…"
          />
          <Button size="sm" :disabled="!canAdd" aria-label="Add remote" @click="add">+</Button>
        </div>
        <label class="mt-2 flex items-center gap-2 text-xs">
          <input v-model="fetchAfter" :disabled="busy || !!editing || !ready" type="checkbox" />
          Fetch remote after adding
        </label>
      </div>
    </div>
  </div>
</template>
