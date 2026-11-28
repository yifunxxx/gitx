<script setup lang="ts">
import { Bell, GitBranch, LoaderCircle, CircleAlert } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useJobsStore, type JobUi } from "@/stores/jobsStore";
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

function jobTitle(job: JobUi) {
  return job.cancelling ? `${job.title} · ${t("status.jobCancelling")}` : job.title;
}
const busyText = computed(() =>
  jobs.count
    ? jobTitle(jobs.running[0]!)
    : jobs.refreshing
      ? t("status.jobsLoading")
      : jobs.refreshError
        ? t("status.jobsUnavailable")
        : t("status.idle"),
);
const jobsTitle = computed(() => {
  const titles = jobs.running.map(
    (job) => jobTitle(job) + (job.message ? ` — ${job.message}` : ""),
  );
  if (jobs.refreshError) titles.push(`${t("status.jobsRefreshFailed")} ${jobs.refreshError}`);
  if (jobs.refreshing) titles.push(t("status.jobsLoading"));
  return titles.join("\n") || busyText.value;
});

function toggleJobsPopup(event: MouseEvent) {
  if (jobs.popupOpen) {
    jobs.closePopup();
    return;
  }
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    jobs.openPopup();
    return;
  }
  const rect = target.getBoundingClientRect();
  // Anchor at the top of the indicator so the menu flips above the status bar.
  jobs.openPopup({ x: rect.left, y: rect.top });
}
</script>

<template>
  <footer
    class="glass-chrome flex h-6 shrink-0 items-center gap-3 border-t bg-dbx-chrome px-2 text-[11px] text-muted-foreground"
  >
    <button
      type="button"
      class="flex min-w-0 max-w-[45%] items-center gap-1 rounded px-1 hover:bg-accent/60 hover:text-foreground"
      :aria-expanded="jobs.popupOpen"
      aria-haspopup="dialog"
      :aria-label="t('status.jobsTitle')"
      :title="jobsTitle"
      @click="toggleJobsPopup"
    >
      <LoaderCircle
        v-if="jobs.count || jobs.refreshing"
        class="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none"
      />
      <CircleAlert
        v-if="jobs.refreshError"
        class="h-3 w-3 shrink-0 text-destructive"
        :aria-label="t('status.jobsUnavailable')"
        role="img"
      />
      <span class="truncate" role="status" aria-live="polite">{{ busyText }}</span>
      <span v-if="jobs.count > 1" class="shrink-0">({{ jobs.count }})</span>
    </button>
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
