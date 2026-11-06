<script setup lang="ts">
import { Bell, GitBranch, LoaderCircle } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useJobsStore } from "@/stores/jobsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useBranchesStore } from "@/stores/branchesStore";

const { t } = useI18n();
const jobs = useJobsStore();
const workspace = useWorkspaceStore();
const branches = useBranchesStore();

const branchText = computed(() => {
  if (!workspace.isRepo) return t("status.noRepo");
  const b = workspace.branch;
  if (!b) return "…";
  if (b.detached) return `detached ${b.head}`;
  return b.head;
});

const busyText = computed(() =>
  jobs.count ? t("status.busy", { count: jobs.count }) : t("status.idle"),
);
</script>

<template>
  <footer
    class="flex h-6 shrink-0 items-center gap-3 border-t bg-dbx-chrome px-2 text-[11px] text-muted-foreground"
  >
    <div class="flex items-center gap-1">
      <LoaderCircle v-if="jobs.count" class="h-3 w-3 animate-spin" />
      <span>{{ busyText }}</span>
    </div>
    <div class="h-3 w-px bg-border" />
    <button
      type="button"
      class="flex items-center gap-1 hover:text-foreground disabled:opacity-50"
      :disabled="!workspace.isRepo"
      @click="branches.openPopup()"
    >
      <GitBranch class="h-3 w-3" />
      <span>{{ branchText }}</span>
      <span v-if="branches.hasUnfetched" class="text-info">↓•</span>
    </button>
    <div class="flex-1" />
    <div class="flex items-center gap-1">
      <Bell class="h-3 w-3" />
      <span>0</span>
    </div>
  </footer>
</template>
