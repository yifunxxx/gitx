<script setup lang="ts">
import { ref } from "vue";
import { Button } from "@/components/ui/button";
import { getBackend } from "@/lib/backend";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorktreesStore } from "@/stores/worktreesStore";
import { useI18n } from "vue-i18n";

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const workspace = useWorkspaceStore();
const store = useWorktreesStore();

const remote = ref("origin");
const refspec = ref("");
const reviewName = ref("");
const location = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

async function onRefChange() {
  const raw = refspec.value.trim();
  // Accept PR number → refs/pull/<n>/head, or full ref.
  let spec = raw;
  let name = reviewName.value.trim();
  if (/^\d+$/.test(raw)) {
    spec = `refs/pull/${raw}/head`;
    if (!name) name = raw;
  } else if (raw.includes("merge-requests")) {
    const m = raw.match(/merge-requests\/(\d+)/);
    if (m && !name) name = m[1];
  } else if (!name) {
    name = raw.split("/").pop() || "review";
  }
  refspec.value = spec;
  reviewName.value = name;
  if (workspace.repoPath && name) {
    const res = await getBackend().worktreeDefaultPath({
      repoPath: workspace.repoPath,
      branch: `review-${name}`,
    });
    location.value = res.path;
  }
}

async function submit() {
  await onRefChange();
  if (!refspec.value.trim() || !location.value.trim() || !reviewName.value.trim()) return;
  busy.value = true;
  error.value = null;
  try {
    await store.openRef({
      worktreePath: location.value.trim(),
      remote: remote.value.trim() || "origin",
      refspec: refspec.value.trim(),
      reviewName: reviewName.value.trim(),
    });
    emit("close");
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <div class="w-[440px] rounded-lg border bg-popover p-4 shadow-lg">
      <div class="mb-1 text-sm font-medium">{{ t("worktrees.openRefTitle") }}</div>
      <p class="mb-3 text-[11px] text-muted-foreground">{{ t("worktrees.openRefHint") }}</p>
      <label class="mb-2 block text-xs">
        <span class="text-muted-foreground">Remote</span>
        <input v-model="remote" class="mt-1 w-full rounded border bg-background px-2 py-1" />
      </label>
      <label class="mb-2 block text-xs">
        <span class="text-muted-foreground">{{ t("worktrees.refOrPr") }}</span>
        <input
          v-model="refspec"
          class="mt-1 w-full rounded border bg-background px-2 py-1 font-mono"
          placeholder="12  or  refs/pull/12/head"
          @blur="onRefChange"
        />
      </label>
      <label class="mb-2 block text-xs">
        <span class="text-muted-foreground">review/… name</span>
        <input v-model="reviewName" class="mt-1 w-full rounded border bg-background px-2 py-1" />
      </label>
      <label class="mb-3 block text-xs">
        <span class="text-muted-foreground">{{ t("worktrees.location") }}</span>
        <input
          v-model="location"
          class="mt-1 w-full rounded border bg-background px-2 py-1 font-mono"
        />
      </label>
      <div v-if="error" class="mb-2 text-xs text-destructive">{{ error }}</div>
      <div class="flex justify-end gap-2">
        <Button size="sm" variant="ghost" @click="emit('close')">{{ t("common.cancel") }}</Button>
        <Button size="sm" :disabled="busy" @click="submit">{{ t("worktrees.create") }}</Button>
      </div>
    </div>
  </div>
</template>
