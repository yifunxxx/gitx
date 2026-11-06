<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { getBackend } from "@/lib/backend";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useWorktreesStore } from "@/stores/worktreesStore";
import { useI18n } from "vue-i18n";

const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const workspace = useWorkspaceStore();
const store = useWorktreesStore();

const startRef = ref("HEAD");
const newBranch = ref("");
const location = ref("");
const openAfter = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  newBranch.value = "";
  startRef.value = "HEAD";
  if (workspace.repoPath) {
    const res = await getBackend().worktreeDefaultPath({
      repoPath: workspace.repoPath,
      branch: newBranch.value || startRef.value,
    });
    location.value = res.path;
  }
});

watch([startRef, newBranch], async () => {
  if (!workspace.repoPath) return;
  const res = await getBackend().worktreeDefaultPath({
    repoPath: workspace.repoPath,
    branch: newBranch.value || startRef.value,
  });
  location.value = res.path;
});

async function submit() {
  if (!location.value.trim()) return;
  busy.value = true;
  error.value = null;
  try {
    await store.create({
      worktreePath: location.value.trim(),
      startRef: startRef.value.trim() || "HEAD",
      newBranch: newBranch.value.trim() || null,
      track: !!newBranch.value.trim(),
      openAfter: openAfter.value,
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
    <div class="w-[420px] rounded-lg border bg-popover p-4 shadow-lg">
      <div class="mb-3 text-sm font-medium">{{ t("worktrees.newTitle") }}</div>
      <label class="mb-2 block text-xs">
        <span class="text-muted-foreground">{{ t("worktrees.from") }}</span>
        <input
          v-model="startRef"
          class="mt-1 w-full rounded border bg-background px-2 py-1"
          placeholder="main / origin/feature / sha"
        />
      </label>
      <label class="mb-2 block text-xs">
        <span class="text-muted-foreground">{{ t("worktrees.newBranch") }}</span>
        <input
          v-model="newBranch"
          class="mt-1 w-full rounded border bg-background px-2 py-1"
          :placeholder="t('worktrees.newBranchHint')"
        />
      </label>
      <label class="mb-2 block text-xs">
        <span class="text-muted-foreground">{{ t("worktrees.location") }}</span>
        <input
          v-model="location"
          class="mt-1 w-full rounded border bg-background px-2 py-1 font-mono"
        />
      </label>
      <label class="mb-3 flex items-center gap-2 text-xs">
        <input v-model="openAfter" type="checkbox" />
        {{ t("worktrees.openAfter") }}
      </label>
      <div v-if="error" class="mb-2 text-xs text-destructive">{{ error }}</div>
      <div class="flex justify-end gap-2">
        <Button size="sm" variant="ghost" @click="emit('close')">{{ t("common.cancel") }}</Button>
        <Button size="sm" :disabled="busy" @click="submit">{{ t("worktrees.create") }}</Button>
      </div>
    </div>
  </div>
</template>
